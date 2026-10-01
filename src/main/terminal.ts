import type { Client, ClientChannel } from 'ssh2'
import { StringDecoder } from 'string_decoder'
import { REMOTE_LIMITS } from '@shared/remote'
import type { Result, TermStateEvent } from '@shared/remote'
import { friendlyError } from './ssh-connect'

export interface TerminalDeps {
  /** Opens a dedicated, authenticated connection for a saved server. */
  connect(serverId: string): Promise<Client>
  emitData(id: string, data: string): void
  emitState(e: TermStateEvent): void
}

interface Term {
  id: string
  serverId: string
  cols: number
  rows: number
  client?: Client
  stream?: ClientChannel
  decoder: StringDecoder
  pending: string
  flushTimer?: NodeJS.Timeout
  /** Characters sent to the UI that it has not rendered yet. */
  unacked: number
  paused: boolean
  closed: boolean
  /** Keystrokes typed while the connection was still being established. */
  early: string[]
}

const ID_RE = /^[\w-]{1,64}$/
const FLUSH_MS = 4
const FLUSH_BYTES = 32 * 1024
const MAX_INPUT = 1024 * 1024
const MAX_EARLY = 64 * 1024

const dim = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1000, Math.max(1, Math.floor(v))) : fallback

/**
 * Interactive shells over SSH: one connection and one PTY per terminal tab. The remote side gets a real
 * `xterm-256color` terminal, so `nano`, `vim`, `htop`, colours and `cat` all behave like in any SSH client.
 */
export class TerminalHub {
  private terms = new Map<string, Term>()

  constructor(private readonly deps: TerminalDeps) {}

  get count(): number {
    return this.terms.size
  }

  async open(id: unknown, serverId: unknown, cols: unknown, rows: unknown): Promise<Result<null>> {
    if (typeof id !== 'string' || !ID_RE.test(id) || typeof serverId !== 'string') return { ok: false, error: 'Unknown item' }
    if (this.terms.has(id)) return { ok: false, error: 'Terminal already open' }
    if (this.terms.size >= REMOTE_LIMITS.maxTerminals) return { ok: false, error: 'Too many open terminals' }
    const t: Term = {
      id,
      serverId,
      cols: dim(cols, 80),
      rows: dim(rows, 24),
      decoder: new StringDecoder('utf8'),
      pending: '',
      unacked: 0,
      paused: false,
      closed: false,
      early: []
    }
    this.terms.set(id, t)
    void this.start(t)
    return { ok: true, data: null }
  }

  input(id: unknown, data: unknown): void {
    const t = typeof id === 'string' ? this.terms.get(id) : undefined
    if (!t || t.closed || typeof data !== 'string' || data.length > MAX_INPUT) return
    if (t.stream) t.stream.write(data)
    else if (t.early.join('').length + data.length <= MAX_EARLY) t.early.push(data)
  }

  resize(id: unknown, cols: unknown, rows: unknown): void {
    const t = typeof id === 'string' ? this.terms.get(id) : undefined
    if (!t || t.closed) return
    t.cols = dim(cols, t.cols)
    t.rows = dim(rows, t.rows)
    try {
      t.stream?.setWindow(t.rows, t.cols, 0, 0)
    } catch {
      /* channel is closing */
    }
  }

  ack(id: unknown, n: unknown): void {
    const t = typeof id === 'string' ? this.terms.get(id) : undefined
    if (!t || typeof n !== 'number' || !Number.isFinite(n)) return
    t.unacked = Math.max(0, t.unacked - n)
    if (t.paused && t.unacked < REMOTE_LIMITS.maxUnacked / 2) {
      t.paused = false
      t.stream?.resume()
    }
  }

  /** The user closed the tab: no state event, the UI already knows. */
  close(id: unknown): void {
    const t = typeof id === 'string' ? this.terms.get(id) : undefined
    if (t) this.teardown(t)
  }

  /** The server was removed: end its terminals. */
  closeServer(serverId: string): void {
    for (const t of [...this.terms.values()]) if (t.serverId === serverId) this.finish(t, 'Server was removed')
  }

  closeAll(): void {
    for (const t of [...this.terms.values()]) this.teardown(t)
  }

  private async start(t: Term): Promise<void> {
    this.deps.emitState({ id: t.id, state: 'connecting' })
    let client: Client
    try {
      client = await this.deps.connect(t.serverId)
    } catch (e) {
      if (!t.closed) this.finish(t, friendlyError(e))
      return
    }
    if (t.closed) {
      client.end()
      return
    }
    t.client = client
    client.on('error', (e) => this.finish(t, friendlyError(e)))
    client.on('close', () => this.finish(t, 'Connection closed'))
    client.shell({ term: 'xterm-256color', cols: t.cols, rows: t.rows, width: 0, height: 0 }, (err, stream) => {
      if (err || t.closed) {
        if (err) this.finish(t, friendlyError(err))
        return
      }
      t.stream = stream
      stream.on('data', (d: Buffer) => this.onData(t, d))
      stream.on('close', (code?: number | null) => this.finish(t, undefined, code ?? null))
      stream.stderr.on('data', (d: Buffer) => this.onData(t, d))
      this.deps.emitState({ id: t.id, state: 'open' })
      for (const chunk of t.early.splice(0)) stream.write(chunk)
      try {
        stream.setWindow(t.rows, t.cols, 0, 0) // the window may have been resized while connecting
      } catch {
        /* closing */
      }
    })
  }

  private onData(t: Term, d: Buffer): void {
    if (t.closed) return
    t.pending += t.decoder.write(d)
    if (t.pending.length >= FLUSH_BYTES) return this.flush(t)
    t.flushTimer ??= setTimeout(() => this.flush(t), FLUSH_MS)
  }

  private flush(t: Term): void {
    if (t.flushTimer) clearTimeout(t.flushTimer)
    t.flushTimer = undefined
    if (!t.pending || t.closed) return
    const data = t.pending
    t.pending = ''
    t.unacked += data.length
    this.deps.emitData(t.id, data)
    if (!t.paused && t.unacked > REMOTE_LIMITS.maxUnacked) {
      t.paused = true
      t.stream?.pause()
    }
  }

  /** The remote side ended (shell exit, dropped connection, failed connect): tell the UI once. */
  private finish(t: Term, error?: string, code?: number | null): void {
    if (t.closed) return
    t.pending += t.decoder.end()
    this.flush(t)
    this.teardown(t)
    this.deps.emitState({ id: t.id, state: 'closed', error, code })
  }

  private teardown(t: Term): void {
    t.closed = true
    if (t.flushTimer) clearTimeout(t.flushTimer)
    this.terms.delete(t.id)
    try {
      t.stream?.end()
      t.client?.end()
    } catch {
      /* already closed */
    }
  }
}
