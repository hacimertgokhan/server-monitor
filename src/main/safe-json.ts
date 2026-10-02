import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface SafeJsonOptions {
  /** Blocks for `ms` milliseconds between read attempts (injectable for tests). */
  sleep?: (ms: number) => void
  /** Read attempts before a file counts as unreadable. */
  attempts?: number
  /** Where read problems are recorded (a `data-load.log` next to the files by default). */
  log?: (message: string) => void
}

const syncSleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * JSON files that hold the user's data (servers, settings ...) with two guarantees:
 *
 * 1. A file that exists but cannot be read right now (antivirus lock at login, a half-finished sync ...) is retried and,
 *    if it still fails, restored from its `.bak` copy. If that fails too the file is marked unsafe and **never
 *    overwritten**, so a temporary read problem can no longer wipe saved data.
 * 2. Every write keeps the previous good version as `<name>.bak`.
 */
export class SafeJson {
  /** Files that could not be read and are therefore protected from being overwritten. */
  readonly problems = new Set<string>()
  private readonly sleep: (ms: number) => void
  private readonly attempts: number
  private readonly logFn: (message: string) => void

  constructor(
    private readonly dir: () => string,
    opts: SafeJsonOptions = {}
  ) {
    this.sleep = opts.sleep ?? syncSleep
    this.attempts = opts.attempts ?? 6
    this.logFn =
      opts.log ??
      ((m) => {
        try {
          appendFileSync(join(this.dir(), 'data-load.log'), `${new Date().toISOString()} ${m}\n`)
        } catch {
          /* logging must never break the app */
        }
      })
  }

  private path(name: string): string {
    return join(this.dir(), name)
  }

  private tryRead<T>(path: string): { ok: true; value: T } | { ok: false; error: unknown } {
    try {
      return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) as T }
    } catch (error) {
      return { ok: false, error }
    }
  }

  read<T>(name: string, fallback: T): T {
    const p = this.path(name)
    const bak = `${p}.bak`

    if (!existsSync(p)) {
      if (existsSync(bak)) {
        const b = this.tryRead<T>(bak)
        if (b.ok) {
          this.logFn(`${name}: file was missing, restored from backup`)
          return b.value
        }
      }
      return fallback // first run
    }

    let last: unknown
    for (let i = 0; i < this.attempts; i++) {
      const r = this.tryRead<T>(p)
      if (r.ok) return r.value
      last = r.error
      const text = last instanceof Error ? last.message : String(last)
      this.logFn(`${name}: read attempt ${i + 1}/${this.attempts} failed: ${text}`)
      if (last instanceof SyntaxError) break // damaged content: waiting will not repair it
      if (i < this.attempts - 1) this.sleep(150 * (i + 1))
    }

    const b = this.tryRead<T>(bak)
    if (b.ok) {
      this.logFn(`${name}: unreadable, restored from backup`)
      return b.value
    }
    this.logFn(`${name}: unreadable and no usable backup; the file is left untouched`)
    this.problems.add(name)
    return fallback
  }

  /** Returns false (and writes nothing) when the file is protected because it could not be read. */
  write(name: string, data: unknown, opts: { backup?: boolean; mode?: number } = {}): boolean {
    if (this.problems.has(name)) {
      this.logFn(`${name}: write skipped, the existing file could not be read`)
      return false
    }
    const p = this.path(name)
    mkdirSync(this.dir(), { recursive: true })
    if (opts.backup !== false && existsSync(p) && this.tryRead(p).ok) {
      try {
        copyFileSync(p, `${p}.bak`)
      } catch (e) {
        this.logFn(`${name}: could not refresh backup: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const tmp = `${p}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: opts.mode })
    renameSync(tmp, p)
    return true
  }

  /** Forget earlier read failures (used by "Retry" after the user fixed the cause). */
  clearProblems(): void {
    this.problems.clear()
  }
}
