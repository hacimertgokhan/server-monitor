import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Transfer } from '@shared/remote'
import { startTestServer } from './ssh-test-server'
import type { TestServer } from './ssh-test-server'
import { SftpHub } from './sftp'

let srv: TestServer
let local: string // plays the user's computer

beforeAll(async () => {
  srv = await startTestServer()
  local = mkdtempSync(join(tmpdir(), 'sm-local-'))
})
afterAll(async () => {
  await srv.close()
  rmSync(local, { recursive: true, force: true })
})

/** Clears both "machines" so every test starts from a known state. */
beforeEach(() => {
  for (const d of [srv.root, local]) for (const f of readdirSync(d)) rmSync(join(d, f), { recursive: true, force: true })
})

function harness(opts: { saveDir?: string | null; upload?: string[] | null } = {}) {
  const transfers: Transfer[] = []
  const hub = new SftpHub({
    connect: () => srv.connect(),
    emitTransfer: (t) => transfers.push(t),
    pickSaveDir: async () => (opts.saveDir === undefined ? local : opts.saveDir),
    pickUpload: async () => opts.upload ?? null
  })
  /** Resolves with the last event of the first transfer once it has finished. */
  const finished = async (count = 1): Promise<Transfer[]> => {
    const t0 = Date.now()
    for (;;) {
      const last = new Map<string, Transfer>()
      for (const t of transfers) last.set(t.id, t)
      const all = [...last.values()]
      if (all.length >= count && all.every((t) => t.state !== 'running')) return all
      if (Date.now() - t0 > 5000) throw new Error(`transfers did not finish: ${JSON.stringify(all)}`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  return { hub, transfers, finished }
}

const remote = (...p: string[]): string => join(srv.root, ...p)
const ok = <T>(r: { ok: boolean; data?: T; error?: string }): T => {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`)
  return r.data as T
}

describe('SftpHub browsing and file operations', () => {
  it('lists a directory: resolved path, kinds, sizes, permissions; "." and ".." are hidden', async () => {
    mkdirSync(remote('docs'))
    writeFileSync(remote('hello.txt'), 'hello world')
    const { hub } = harness()
    const root = ok(await hub.list('s', '/'))
    expect(root.path).toBe('/')
    const byName = Object.fromEntries(root.entries.map((e) => [e.name, e]))
    expect(Object.keys(byName).sort()).toEqual(['docs', 'hello.txt'])
    expect(byName['docs'].kind).toBe('dir')
    expect(byName['hello.txt']).toMatchObject({ kind: 'file', size: 11 })
    expect(byName['hello.txt'].mtime).toBeGreaterThan(Date.now() - 60_000)
    expect(ok(await hub.list('s', null)).path).toBe('/') // null = home
    hub.closeAll()
  })

  it('reports readable errors for missing paths and invalid arguments', async () => {
    const { hub } = harness()
    expect(await hub.list('s', '/nope')).toEqual({ ok: false, error: 'No such file or folder' })
    expect(await hub.mkdir('s', 'relative/path')).toEqual({ ok: false, error: 'Invalid path' })
    expect(await hub.mkdir(42, '/x')).toEqual({ ok: false, error: 'Unknown item' })
    expect(await hub.remove('s', [])).toEqual({ ok: false, error: 'Nothing selected' })
    expect(await hub.chmod('s', '/x', 99999)).toEqual({ ok: false, error: 'Invalid permissions' })
    hub.closeAll()
  })

  it('creates folders and empty files, refuses to overwrite with create, and renames', async () => {
    const { hub } = harness()
    ok(await hub.mkdir('s', '/projects'))
    ok(await hub.create('s', '/projects/a.txt'))
    expect(existsSync(remote('projects', 'a.txt'))).toBe(true)
    expect((await hub.create('s', '/projects/a.txt')).ok).toBe(false)
    ok(await hub.rename('s', '/projects/a.txt', '/projects/b.txt'))
    expect(readdirSync(remote('projects'))).toEqual(['b.txt'])
    hub.closeAll()
  })

  it('deletes files and whole folder trees, but never the root', async () => {
    mkdirSync(remote('tree', 'deep', 'deeper'), { recursive: true })
    writeFileSync(remote('tree', 'deep', 'deeper', 'f.txt'), 'x')
    writeFileSync(remote('tree', 'top.txt'), 'x')
    writeFileSync(remote('single.txt'), 'x')
    const { hub } = harness()
    ok(await hub.remove('s', ['/tree', '/single.txt']))
    expect(readdirSync(srv.root)).toEqual([])
    writeFileSync(remote('keep.txt'), 'x')
    expect(await hub.remove('s', ['/'])).toEqual({ ok: false, error: 'Refusing to delete the root folder' })
    expect(existsSync(remote('keep.txt'))).toBe(true)
    hub.closeAll()
  })

  it('reads and writes text, keeping UTF-8 intact', async () => {
    const { hub } = harness()
    ok(await hub.writeText('s', '/notes.txt', 'Merhaba dünya ğüşiöç İ\nline 2\n'))
    expect(readFileSync(remote('notes.txt'), 'utf8')).toBe('Merhaba dünya ğüşiöç İ\nline 2\n')
    const r = ok(await hub.readText('s', '/notes.txt'))
    expect(r.text).toBe('Merhaba dünya ğüşiöç İ\nline 2\n')
    ok(await hub.writeText('s', '/notes.txt', 'short')) // truncates
    expect(readFileSync(remote('notes.txt'), 'utf8')).toBe('short')
    hub.closeAll()
  })

  it('refuses to open binary files, folders and files above the editor limit', async () => {
    writeFileSync(remote('bin.dat'), Buffer.from([1, 2, 0, 3, 4]))
    writeFileSync(remote('huge.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 97))
    mkdirSync(remote('dir'))
    const { hub } = harness()
    expect(await hub.readText('s', '/bin.dat')).toEqual({ ok: false, error: 'This looks like a binary file' })
    expect(await hub.readText('s', '/huge.txt')).toEqual({ ok: false, error: 'File is too large to edit here (max 2 MB)' })
    expect(await hub.readText('s', '/dir')).toEqual({ ok: false, error: 'This is a folder' })
    hub.closeAll()
  })

  it('reuses one connection for many operations and reconnects after it drops', async () => {
    const before = srv.seen.connections
    const { hub } = harness()
    await Promise.all([hub.list('s', '/'), hub.list('s', '/'), hub.list('s', '/')])
    ok(await hub.mkdir('s', '/once'))
    expect(srv.seen.connections - before).toBe(1)
    hub.closeServer('s')
    ok(await hub.list('s', '/'))
    expect(srv.seen.connections - before).toBe(2)
    hub.closeAll()
  })
})

describe('SftpHub transfers', () => {
  it('uploads a file and reports progress ending in "done"', async () => {
    const data = Buffer.alloc(900_000, 'abc')
    writeFileSync(join(local, 'big.bin'), data)
    const { hub, finished, transfers } = harness()
    expect(ok(await hub.upload('s', '/', [join(local, 'big.bin')]))).toEqual({ started: 1 })
    const [t] = await finished()
    expect(t).toMatchObject({ state: 'done', direction: 'up', name: 'big.bin', files: 1, total: 900_000, done: 900_000, target: '/' })
    expect(readFileSync(remote('big.bin')).equals(data)).toBe(true)
    expect(transfers[0].state).toBe('running') // the first event is the "started" one
    hub.closeAll()
  })

  it('uploads a folder recursively, including empty folders', async () => {
    mkdirSync(join(local, 'site', 'css'), { recursive: true })
    mkdirSync(join(local, 'site', 'empty'))
    writeFileSync(join(local, 'site', 'index.html'), '<h1>hi</h1>')
    writeFileSync(join(local, 'site', 'css', 'a.css'), 'body{}')
    const { hub, finished } = harness()
    ok(await hub.upload('s', '/', [join(local, 'site')]))
    const [t] = await finished()
    expect(t).toMatchObject({ state: 'done', files: 2 })
    expect(readFileSync(remote('site', 'index.html'), 'utf8')).toBe('<h1>hi</h1>')
    expect(readFileSync(remote('site', 'css', 'a.css'), 'utf8')).toBe('body{}')
    expect(existsSync(remote('site', 'empty'))).toBe(true)
    hub.closeAll()
  })

  it('uploads into an existing remote folder (merging) and overwrites files of the same name', async () => {
    mkdirSync(remote('site'))
    writeFileSync(remote('site', 'old.txt'), 'old')
    writeFileSync(remote('site', 'same.txt'), 'old content')
    mkdirSync(join(local, 'site'))
    writeFileSync(join(local, 'site', 'same.txt'), 'new')
    const { hub, finished } = harness()
    ok(await hub.upload('s', '/', [join(local, 'site')]))
    expect((await finished())[0].state).toBe('done')
    expect(readFileSync(remote('site', 'same.txt'), 'utf8')).toBe('new')
    expect(readFileSync(remote('site', 'old.txt'), 'utf8')).toBe('old')
    hub.closeAll()
  })

  it('uploadPick uploads what the native dialog returned and does nothing when it is cancelled', async () => {
    writeFileSync(join(local, 'a.txt'), 'a')
    writeFileSync(join(local, 'b.txt'), 'b')
    const picked = harness({ upload: [join(local, 'a.txt'), join(local, 'b.txt')] })
    expect(ok(await picked.hub.uploadPick('s', '/', 'files'))).toEqual({ started: 2 })
    await picked.finished(2)
    expect(readdirSync(srv.root).sort()).toEqual(['a.txt', 'b.txt'])
    picked.hub.closeAll()
    const cancelled = harness({ upload: null })
    expect(ok(await cancelled.hub.uploadPick('s', '/', 'folder'))).toEqual({ started: 0 })
    expect(cancelled.transfers).toEqual([])
  })

  it('ignores local paths that do not exist and relative remote targets', async () => {
    const { hub } = harness()
    expect(await hub.upload('s', '/', [join(local, 'missing.txt')])).toEqual({ ok: false, error: 'Nothing selected' })
    expect(await hub.upload('s', 'relative', [join(local, 'x')])).toEqual({ ok: false, error: 'Invalid path' })
    expect(await hub.upload('s', '/', ['relative.txt'])).toEqual({ ok: false, error: 'Nothing selected' })
    hub.closeAll()
  })

  it('downloads files and folders into the chosen directory', async () => {
    mkdirSync(remote('logs', 'old'), { recursive: true })
    writeFileSync(remote('logs', 'app.log'), 'line1\nline2\n')
    writeFileSync(remote('logs', 'old', '1.log'), 'x')
    writeFileSync(remote('readme.md'), '# hi')
    const { hub, finished } = harness()
    expect(ok(await hub.download('s', ['/logs', '/readme.md']))).toEqual({ started: 2 })
    const done = await finished(2)
    expect(done.every((t) => t.state === 'done' && t.direction === 'down')).toBe(true)
    expect(readFileSync(join(local, 'logs', 'app.log'), 'utf8')).toBe('line1\nline2\n')
    expect(readFileSync(join(local, 'logs', 'old', '1.log'), 'utf8')).toBe('x')
    expect(readFileSync(join(local, 'readme.md'), 'utf8')).toBe('# hi')
    hub.closeAll()
  })

  it('never overwrites an existing local file: it picks "name (1)" instead', async () => {
    writeFileSync(remote('a.txt'), 'remote')
    writeFileSync(join(local, 'a.txt'), 'precious local data')
    const { hub, finished } = harness()
    ok(await hub.download('s', ['/a.txt']))
    const [t] = await finished()
    expect(t.name).toBe('a (1).txt')
    expect(readFileSync(join(local, 'a.txt'), 'utf8')).toBe('precious local data')
    expect(readFileSync(join(local, 'a (1).txt'), 'utf8')).toBe('remote')
    hub.closeAll()
  })

  it('starts nothing when the save dialog is cancelled', async () => {
    writeFileSync(remote('a.txt'), 'x')
    const { hub, transfers } = harness({ saveDir: null })
    expect(ok(await hub.download('s', ['/a.txt']))).toEqual({ started: 0 })
    expect(transfers).toEqual([])
    hub.closeAll()
  })

  it('fails a transfer of a missing remote file with a readable error', async () => {
    const { hub, finished } = harness()
    ok(await hub.download('s', ['/ghost.txt']))
    const [t] = await finished()
    expect(t).toMatchObject({ state: 'error', error: 'No such file or folder' })
    hub.closeAll()
  })

  it('cancels a running transfer and removes the partial file', async () => {
    writeFileSync(remote('large.bin'), Buffer.alloc(40 * 1024 * 1024, 1))
    const { hub, finished, transfers } = harness()
    ok(await hub.download('s', ['/large.bin']))
    const id = transfers[0].id
    hub.cancel(id)
    const [t] = await finished()
    expect(t.state).toBe('cancelled')
    expect(readdirSync(local).filter((f) => f.startsWith('large'))).toEqual([])
    hub.closeAll()
  })
})
