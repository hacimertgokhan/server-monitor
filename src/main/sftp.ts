import type { Client, SFTPWrapper, Stats } from 'ssh2'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import { lstat, mkdir, readdir, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { basename, extname, isAbsolute, join as localJoin } from 'path'
import { pipeline } from 'stream/promises'
import { REMOTE_LIMITS, posix } from '@shared/remote'
import type { Result, SftpEntry, SftpListing, Transfer } from '@shared/remote'
import { friendlyError } from './ssh-connect'

export interface SftpDeps {
  connect(serverId: string): Promise<Client>
  emitTransfer(t: Transfer): void
  /** Native "choose a folder to save into" dialog; null when cancelled. */
  pickSaveDir(): Promise<string | null>
  /** Native picker for files or one folder to upload; null when cancelled. */
  pickUpload(kind: 'files' | 'folder'): Promise<string[] | null>
  /** Connections without activity for this long are closed (default 5 minutes). */
  idleMs?: number
}

interface Session {
  client: Client
  sftp: SFTPWrapper
  busy: number
  idle?: NodeJS.Timeout
}

interface PlanItem {
  /** Path relative to the transferred root, '/'-separated. */
  rel: string
  size: number
  dir: boolean
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000
const S_IFREG = 0o100000
const CHUNK = 256 * 1024
const MAX_EDIT_WRITE = 4 * 1024 * 1024
const MAX_PLAN = 200_000
const EMIT_MS = 150

/** SFTP status codes → readable messages (translated in the UI). */
function sftpError(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  if (code === 2) return 'No such file or folder'
  if (code === 3) return 'Permission denied'
  if (code === 4) return 'Operation failed (does it already exist?)'
  return friendlyError(e)
}

const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: sftpError(e) })

const kindOf = (mode: number): SftpEntry['kind'] =>
  (mode & S_IFMT) === S_IFDIR ? 'dir' : (mode & S_IFMT) === S_IFLNK ? 'link' : (mode & S_IFMT) === S_IFREG ? 'file' : 'other'

const cb = <T>(fn: (done: (err: Error | null | undefined, v?: T) => void) => void): Promise<T> =>
  new Promise<T>((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v as T))))

const okVoid = (err: Error | null | undefined, resolve: () => void, reject: (e: Error) => void): void => (err ? reject(err) : resolve())

/** Uploads, downloads and file operations over SFTP, one lazily opened (and idle-closed) connection per server. */
export class SftpHub {
  private sessions = new Map<string, Session>()
  private opening = new Map<string, Promise<Session>>()
  private jobs = new Map<string, AbortController>()

  constructor(private readonly deps: SftpDeps) {}

  // ------------------------------------------------------------ connection
  private async session(serverId: string): Promise<Session> {
    const live = this.sessions.get(serverId)
    if (live) return live
    let p = this.opening.get(serverId)
    if (!p) {
      p = this.openSession(serverId).finally(() => this.opening.delete(serverId))
      this.opening.set(serverId, p)
    }
    return p
  }

  private async openSession(serverId: string): Promise<Session> {
    const client = await this.deps.connect(serverId)
    let sftp: SFTPWrapper
    try {
      sftp = await cb<SFTPWrapper>((done) => client.sftp(done))
    } catch (e) {
      client.end()
      throw e
    }
    const s: Session = { client, sftp, busy: 0 }
    const drop = (): void => {
      if (this.sessions.get(serverId) === s) this.sessions.delete(serverId)
      if (s.idle) clearTimeout(s.idle)
    }
    client.on('error', drop)
    client.on('close', drop)
    this.sessions.set(serverId, s)
    this.touch(serverId, s)
    return s
  }

  private touch(serverId: string, s: Session): void {
    if (s.idle) clearTimeout(s.idle)
    s.idle = setTimeout(() => {
      if (s.busy > 0) return this.touch(serverId, s)
      this.sessions.delete(serverId)
      s.client.end()
    }, this.deps.idleMs ?? 300_000)
    s.idle.unref?.()
  }

  /** Runs one operation on the server's SFTP session and turns failures into a result the UI can show. */
  private async run<T>(serverId: unknown, op: (sftp: SFTPWrapper) => Promise<T>): Promise<Result<T>> {
    if (typeof serverId !== 'string') return { ok: false, error: 'Unknown item' }
    let s: Session
    try {
      s = await this.session(serverId)
    } catch (e) {
      return fail(e)
    }
    s.busy++
    try {
      return { ok: true, data: await op(s.sftp) }
    } catch (e) {
      return fail(e)
    } finally {
      s.busy--
      this.touch(serverId, s)
    }
  }

  /** The server was removed: drop its connection and stop its transfers. */
  closeServer(serverId: string): void {
    const s = this.sessions.get(serverId)
    if (!s) return
    if (s.idle) clearTimeout(s.idle)
    this.sessions.delete(serverId)
    s.client.end()
  }

  closeAll(): void {
    for (const c of this.jobs.values()) c.abort()
    for (const s of this.sessions.values()) {
      if (s.idle) clearTimeout(s.idle)
      s.client.end()
    }
    this.sessions.clear()
  }

  // ------------------------------------------------------------ browsing and file operations
  list(serverId: unknown, path: unknown): Promise<Result<SftpListing>> {
    return this.run(serverId, async (sftp) => {
      const abs = await cb<string>((done) => sftp.realpath(typeof path === 'string' && path ? path : '.', done))
      const raw = await cb<{ filename: string; attrs: Stats }[]>((done) => sftp.readdir(abs, done))
      const entries: SftpEntry[] = []
      for (const f of raw) {
        if (f.filename === '.' || f.filename === '..') continue
        const a = f.attrs
        entries.push({
          name: f.filename,
          kind: kindOf(a.mode),
          size: a.size ?? 0,
          mtime: (a.mtime ?? 0) * 1000,
          mode: a.mode & 0o7777,
          uid: a.uid,
          gid: a.gid
        })
      }
      // A symlink to a folder should behave like a folder (open on double click).
      const links = entries.filter((e) => e.kind === 'link').slice(0, 500)
      await Promise.all(
        links.map(async (e) => {
          try {
            const st = await cb<Stats>((done) => sftp.stat(posix.join(abs, e.name), done))
            e.linkToDir = (st.mode & S_IFMT) === S_IFDIR
          } catch {
            /* dangling link */
          }
        })
      )
      return { path: abs, entries }
    })
  }

  mkdir(serverId: unknown, path: unknown): Promise<Result<null>> {
    return this.run(serverId, async (sftp) => {
      await new Promise<void>((res, rej) => sftp.mkdir(this.abs(path), (e) => okVoid(e, res, rej)))
      return null
    })
  }

  create(serverId: unknown, path: unknown): Promise<Result<null>> {
    return this.run(serverId, async (sftp) => {
      const p = this.abs(path)
      await new Promise<void>((resolve, reject) => {
        const w = sftp.createWriteStream(p, { flags: 'wx', mode: 0o644 })
        w.once('error', reject)
        w.once('close', resolve)
        w.end()
      })
      return null
    })
  }

  rename(serverId: unknown, from: unknown, to: unknown): Promise<Result<null>> {
    return this.run(serverId, async (sftp) => {
      await new Promise<void>((res, rej) => sftp.rename(this.abs(from), this.abs(to), (e) => okVoid(e, res, rej)))
      return null
    })
  }

  chmod(serverId: unknown, path: unknown, mode: unknown): Promise<Result<null>> {
    return this.run(serverId, async (sftp) => {
      if (typeof mode !== 'number' || !Number.isInteger(mode) || mode < 0 || mode > 0o7777) throw new Error('Invalid permissions')
      await new Promise<void>((res, rej) => sftp.chmod(this.abs(path), mode, (e) => okVoid(e, res, rej)))
      return null
    })
  }

  remove(serverId: unknown, paths: unknown): Promise<Result<null>> {
    return this.run(serverId, async (sftp) => {
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > 1000) throw new Error('Nothing selected')
      for (const p of paths) await this.rmrf(sftp, this.abs(p), 0)
      return null
    })
  }

  private async rmrf(sftp: SFTPWrapper, path: string, depth: number): Promise<void> {
    if (path === '/') throw new Error('Refusing to delete the root folder')
    if (depth > 64) throw new Error('Folder tree is too deep')
    const st = await cb<Stats>((done) => sftp.lstat(path, done))
    if ((st.mode & S_IFMT) !== S_IFDIR) {
      return new Promise<void>((res, rej) => sftp.unlink(path, (e) => okVoid(e, res, rej)))
    }
    const kids = await cb<{ filename: string }[]>((done) => sftp.readdir(path, done))
    for (const k of kids) if (k.filename !== '.' && k.filename !== '..') await this.rmrf(sftp, posix.join(path, k.filename), depth + 1)
    await new Promise<void>((res, rej) => sftp.rmdir(path, (e) => okVoid(e, res, rej)))
  }

  readText(serverId: unknown, path: unknown): Promise<Result<{ text: string; size: number }>> {
    return this.run(serverId, async (sftp) => {
      const p = this.abs(path)
      const st = await cb<Stats>((done) => sftp.stat(p, done))
      if ((st.mode & S_IFMT) === S_IFDIR) throw new Error('This is a folder')
      if (st.size > REMOTE_LIMITS.maxEditBytes) throw new Error('File is too large to edit here (max 2 MB)')
      const chunks: Buffer[] = []
      await pipeline(sftp.createReadStream(p, { highWaterMark: CHUNK }), async function (source: AsyncIterable<Buffer>) {
        for await (const c of source) chunks.push(c)
      })
      const buf = Buffer.concat(chunks)
      if (buf.subarray(0, 8192).includes(0)) throw new Error('This looks like a binary file')
      return { text: buf.toString('utf8'), size: buf.length }
    })
  }

  writeText(serverId: unknown, path: unknown, text: unknown): Promise<Result<null>> {
    return this.run(serverId, async (sftp) => {
      if (typeof text !== 'string') throw new Error('Invalid content')
      const data = Buffer.from(text, 'utf8')
      if (data.length > MAX_EDIT_WRITE) throw new Error('File is too large to edit here (max 2 MB)')
      // flags 'w' truncates and keeps the permissions of an existing file; new files get 0644.
      await new Promise<void>((resolve, reject) => {
        const w = sftp.createWriteStream(this.abs(path), { flags: 'w', mode: 0o644 })
        w.once('error', reject)
        w.once('close', resolve)
        w.end(data)
      })
      return null
    })
  }

  private abs(p: unknown): string {
    if (typeof p !== 'string' || !p.startsWith('/') || p.includes('\0')) throw new Error('Invalid path')
    return p
  }

  // ------------------------------------------------------------ transfers
  cancel(transferId: unknown): void {
    if (typeof transferId === 'string') this.jobs.get(transferId)?.abort()
  }

  async download(serverId: unknown, paths: unknown): Promise<Result<{ started: number }>> {
    if (typeof serverId !== 'string' || !Array.isArray(paths) || paths.length === 0 || paths.length > 1000) {
      return { ok: false, error: 'Nothing selected' }
    }
    const remote = paths.map((p) => this.abs(p))
    const dir = await this.deps.pickSaveDir()
    if (!dir) return { ok: true, data: { started: 0 } }
    for (const rp of remote) this.startJob(serverId, 'down', rp, dir)
    return { ok: true, data: { started: remote.length } }
  }

  async uploadPick(serverId: unknown, remoteDir: unknown, kind: unknown): Promise<Result<{ started: number }>> {
    const picked = await this.deps.pickUpload(kind === 'folder' ? 'folder' : 'files')
    if (!picked || picked.length === 0) return { ok: true, data: { started: 0 } }
    return this.upload(serverId, remoteDir, picked)
  }

  async upload(serverId: unknown, remoteDir: unknown, localPaths: unknown): Promise<Result<{ started: number }>> {
    if (typeof serverId !== 'string' || !Array.isArray(localPaths) || localPaths.length === 0 || localPaths.length > 1000) {
      return { ok: false, error: 'Nothing selected' }
    }
    let dir: string
    try {
      dir = this.abs(remoteDir)
    } catch (e) {
      return fail(e)
    }
    const locals = localPaths.filter((p): p is string => typeof p === 'string' && isAbsolute(p) && existsSync(p))
    if (locals.length === 0) return { ok: false, error: 'Nothing selected' }
    for (const lp of locals) this.startJob(serverId, 'up', lp, dir)
    return { ok: true, data: { started: locals.length } }
  }

  /** Registers a transfer and runs it in the background; progress and the outcome arrive through `emitTransfer`. */
  private startJob(serverId: string, direction: 'up' | 'down', source: string, targetDir: string): void {
    const id = randomUUID()
    const ctl = new AbortController()
    this.jobs.set(id, ctl)
    const t: Transfer = {
      id,
      serverId,
      direction,
      name: direction === 'up' ? basename(source) : posix.basename(source),
      target: targetDir,
      done: 0,
      total: 0,
      files: 0,
      state: 'running'
    }
    let last = 0
    const emit = (force = false): void => {
      const now = Date.now()
      if (!force && now - last < EMIT_MS) return
      last = now
      this.deps.emitTransfer({ ...t })
    }
    emit(true)
    void (async () => {
      try {
        const r = await this.run(serverId, async (sftp) => {
          if (direction === 'up') await this.doUpload(sftp, source, targetDir, t, ctl.signal, emit)
          else await this.doDownload(sftp, source, targetDir, t, ctl.signal, emit)
          return null
        })
        if (r.ok) t.state = 'done'
        else {
          t.state = ctl.signal.aborted ? 'cancelled' : 'error'
          t.error = r.error
        }
      } catch (e) {
        t.state = ctl.signal.aborted ? 'cancelled' : 'error'
        t.error = sftpError(e)
      } finally {
        if (ctl.signal.aborted) t.state = 'cancelled'
        this.jobs.delete(id)
        emit(true)
      }
    })()
  }

  private async doDownload(
    sftp: SFTPWrapper,
    remoteRoot: string,
    localDir: string,
    t: Transfer,
    signal: AbortSignal,
    emit: () => void
  ): Promise<void> {
    const plan = await this.planRemote(sftp, remoteRoot)
    t.total = plan.reduce((n, p) => n + p.size, 0)
    t.files = plan.filter((p) => !p.dir).length
    const root = this.uniqueLocal(localDir, posix.basename(remoteRoot) || 'download')
    t.name = basename(root)
    for (const item of plan) {
      if (signal.aborted) throw new Error('Cancelled')
      const target = item.rel ? localJoin(root, ...item.rel.split('/')) : root
      if (item.dir) {
        await mkdir(target, { recursive: true })
        continue
      }
      const src = item.rel ? posix.join(remoteRoot, item.rel) : remoteRoot
      try {
        await pipeline(
          sftp.createReadStream(src, { highWaterMark: CHUNK }).on('data', (c: Buffer) => {
            t.done += c.length
            emit()
          }),
          createWriteStream(target),
          { signal }
        )
      } catch (e) {
        await rm(target, { force: true }).catch(() => undefined) // never leave a half-written file behind
        throw e
      }
    }
  }

  private async doUpload(
    sftp: SFTPWrapper,
    localRoot: string,
    remoteDir: string,
    t: Transfer,
    signal: AbortSignal,
    emit: () => void
  ): Promise<void> {
    const plan = await this.planLocal(localRoot)
    t.total = plan.reduce((n, p) => n + p.size, 0)
    t.files = plan.filter((p) => !p.dir).length
    const root = posix.join(remoteDir, basename(localRoot))
    for (const item of plan) {
      if (signal.aborted) throw new Error('Cancelled')
      const target = item.rel ? posix.join(root, item.rel) : root
      if (item.dir) {
        await this.mkdirIfMissing(sftp, target)
        continue
      }
      try {
        await pipeline(
          createReadStream(item.rel ? localJoin(localRoot, ...item.rel.split('/')) : localRoot, { highWaterMark: CHUNK }).on(
            'data',
            (c: string | Buffer) => {
              t.done += c.length
              emit()
            }
          ),
          sftp.createWriteStream(target, { flags: 'w', mode: 0o644, highWaterMark: CHUNK }),
          { signal }
        )
      } catch (e) {
        await new Promise<void>((res) => sftp.unlink(target, () => res())) // best effort: remove the partial file
        throw e
      }
    }
  }

  private async mkdirIfMissing(sftp: SFTPWrapper, path: string): Promise<void> {
    try {
      await new Promise<void>((res, rej) => sftp.mkdir(path, (e) => okVoid(e, res, rej)))
    } catch (e) {
      const st = await cb<Stats>((done) => sftp.stat(path, done)).catch(() => null)
      if (!st || (st.mode & S_IFMT) !== S_IFDIR) throw e
    }
  }

  /** The folder (or file) to transfer plus everything below it, parents first. Symlinks are not followed. */
  private async planRemote(sftp: SFTPWrapper, root: string): Promise<PlanItem[]> {
    const out: PlanItem[] = []
    const walk = async (path: string, rel: string, depth: number): Promise<void> => {
      if (out.length > MAX_PLAN || depth > 64) throw new Error('Folder tree is too large')
      const st = await cb<Stats>((done) => sftp.stat(path, done))
      if ((st.mode & S_IFMT) !== S_IFDIR) return void out.push({ rel, size: st.size ?? 0, dir: false })
      out.push({ rel, size: 0, dir: true })
      const kids = await cb<{ filename: string; attrs: Stats }[]>((done) => sftp.readdir(path, done))
      for (const k of kids) {
        if (k.filename === '.' || k.filename === '..') continue
        const childRel = rel ? `${rel}/${k.filename}` : k.filename
        if ((k.attrs.mode & S_IFMT) === S_IFLNK) continue
        await walk(posix.join(path, k.filename), childRel, depth + 1)
      }
    }
    await walk(root, '', 0)
    return out
  }

  private async planLocal(root: string): Promise<PlanItem[]> {
    const out: PlanItem[] = []
    const walk = async (path: string, rel: string, depth: number): Promise<void> => {
      if (out.length > MAX_PLAN || depth > 64) throw new Error('Folder tree is too large')
      const st = await lstat(path)
      if (st.isSymbolicLink()) return
      if (!st.isDirectory()) return void out.push({ rel, size: st.size, dir: false })
      out.push({ rel, size: 0, dir: true })
      for (const k of await readdir(path)) await walk(localJoin(path, k), rel ? `${rel}/${k}` : k, depth + 1)
    }
    await walk(root, '', 0)
    return out
  }

  /** "name", then "name (1)", "name (2)" ... so a download never overwrites an existing local file. */
  private uniqueLocal(dir: string, name: string): string {
    let p = localJoin(dir, name)
    if (!existsSync(p)) return p
    const ext = extname(name)
    const stem = ext ? name.slice(0, -ext.length) : name
    for (let i = 1; i < 10_000; i++) {
      p = localJoin(dir, `${stem} (${i})${ext}`)
      if (!existsSync(p)) return p
    }
    return p
  }
}
