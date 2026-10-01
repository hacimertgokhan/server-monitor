/**
 * An in-process SSH server for tests: password login, a scriptable fake shell with PTY support and an SFTP subsystem
 * backed by a real temporary directory. Lets the terminal and file-manager code run against a genuine SSH protocol
 * implementation without any external service.
 */
import { Client, Server, utils } from 'ssh2'
import type { Connection, PseudoTtyInfo, ServerChannel, WindowChangeInfo } from 'ssh2'
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeSync,
  chmodSync
} from 'fs'
import type { Stats } from 'fs'
import { tmpdir } from 'os'
import { join, normalize, sep } from 'path'

const { STATUS_CODE, flagsToString } = utils.sftp

export const TEST_USER = 'tester'
export const TEST_PASSWORD = 'pw'

export interface TestServer {
  port: number
  /** Directory that appears as "/" to SFTP clients. */
  root: string
  /** What the fake shell observed. */
  seen: { pty?: PseudoTtyInfo; windows: WindowChangeInfo[]; connections: number; closed: number }
  connect(): Promise<Client>
  close(): Promise<void>
}

interface Attrs {
  mode: number
  uid: number
  gid: number
  size: number
  atime: number
  mtime: number
}

/** The server-side SFTP stream has a different surface than the typed client wrapper. */
interface SftpServerStream {
  on(ev: string, fn: (reqid: number, ...args: never[]) => void): void
  handle(reqid: number, h: Buffer): void
  status(reqid: number, code: number, message?: string): void
  data(reqid: number, data: Buffer): void
  attrs(reqid: number, a: Attrs): void
  name(reqid: number, list: { filename: string; longname: string; attrs: Attrs }[]): void
}

const toAttrs = (st: Stats): Attrs => ({
  mode: st.mode,
  uid: st.uid,
  gid: st.gid,
  size: st.size,
  atime: Math.floor(st.atimeMs / 1000),
  mtime: Math.floor(st.mtimeMs / 1000)
})

const codeOf = (e: unknown): number => {
  const c = (e as { code?: string } | null)?.code
  return c === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : c === 'EACCES' || c === 'EPERM' ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE
}

function serveSftp(sftp: SftpServerStream, root: string): void {
  const real = (p: string): string => {
    const full = normalize(join(root, p))
    if (full !== root && !full.startsWith(root + sep)) throw Object.assign(new Error('escape'), { code: 'EACCES' })
    return full
  }
  type H = { fd?: number; dir?: string; sent?: boolean }
  const handles = new Map<number, H>()
  let next = 1
  const newHandle = (h: H): Buffer => {
    const id = next++
    handles.set(id, h)
    const b = Buffer.alloc(4)
    b.writeUInt32BE(id)
    return b
  }
  const lookup = (b: Buffer): H | undefined => handles.get(b.readUInt32BE(0))
  const guard = (reqid: number, fn: () => void): void => {
    try {
      fn()
    } catch (e) {
      sftp.status(reqid, codeOf(e))
    }
  }
  const on = (ev: string, fn: (reqid: number, ...a: never[]) => void): void => sftp.on(ev, fn)

  on('REALPATH', ((reqid: number, p: string) => {
    const abs = (
      '/' +
      normalize(p === '.' ? '/' : p)
        .split(sep)
        .join('/')
    ).replace(/\/+/g, '/')
    sftp.name(reqid, [{ filename: abs, longname: abs, attrs: { mode: 0, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 } }])
  }) as never)
  const stat = ((reqid: number, p: string) => guard(reqid, () => sftp.attrs(reqid, toAttrs(statSync(real(p)))))) as never
  on('STAT', stat)
  on('LSTAT', ((reqid: number, p: string) => guard(reqid, () => sftp.attrs(reqid, toAttrs(lstatSync(real(p)))))) as never)
  on('FSTAT', ((reqid: number, h: Buffer) =>
    guard(reqid, () => {
      const e = lookup(h)
      if (e?.fd === undefined) throw new Error('bad handle')
      sftp.attrs(reqid, toAttrs(fstatSync(e.fd)))
    })) as never)
  on('OPEN', ((reqid: number, filename: string, flags: number) =>
    guard(reqid, () => {
      const fd = openSync(real(filename), flagsToString(flags) ?? 'r', 0o644)
      sftp.handle(reqid, newHandle({ fd }))
    })) as never)
  on('READ', ((reqid: number, h: Buffer, offset: number, length: number) =>
    guard(reqid, () => {
      const e = lookup(h)
      if (e?.fd === undefined) throw new Error('bad handle')
      const buf = Buffer.alloc(length)
      const n = readSync(e.fd, buf, 0, length, offset)
      if (n === 0) return sftp.status(reqid, STATUS_CODE.EOF)
      sftp.data(reqid, buf.subarray(0, n))
    })) as never)
  on('WRITE', ((reqid: number, h: Buffer, offset: number, data: Buffer) =>
    guard(reqid, () => {
      const e = lookup(h)
      if (e?.fd === undefined) throw new Error('bad handle')
      writeSync(e.fd, data, 0, data.length, offset)
      sftp.status(reqid, STATUS_CODE.OK)
    })) as never)
  on('CLOSE', ((reqid: number, h: Buffer) =>
    guard(reqid, () => {
      const e = lookup(h)
      if (e?.fd !== undefined) closeSync(e.fd)
      handles.delete(h.readUInt32BE(0))
      sftp.status(reqid, STATUS_CODE.OK)
    })) as never)
  on('OPENDIR', ((reqid: number, p: string) =>
    guard(reqid, () => {
      const dir = real(p)
      if (!statSync(dir).isDirectory()) throw new Error('not a directory')
      sftp.handle(reqid, newHandle({ dir }))
    })) as never)
  on('READDIR', ((reqid: number, h: Buffer) =>
    guard(reqid, () => {
      const e = lookup(h)
      if (!e?.dir || e.sent) return sftp.status(reqid, STATUS_CODE.EOF)
      e.sent = true
      const list = readdirSync(e.dir).map((filename) => ({
        filename,
        longname: filename,
        attrs: toAttrs(lstatSync(join(e.dir as string, filename)))
      }))
      if (list.length === 0) return sftp.status(reqid, STATUS_CODE.EOF)
      sftp.name(reqid, list)
    })) as never)
  on('MKDIR', ((reqid: number, p: string) =>
    guard(reqid, () => {
      mkdirSync(real(p))
      sftp.status(reqid, STATUS_CODE.OK)
    })) as never)
  on('RMDIR', ((reqid: number, p: string) =>
    guard(reqid, () => {
      rmdirSync(real(p))
      sftp.status(reqid, STATUS_CODE.OK)
    })) as never)
  on('REMOVE', ((reqid: number, p: string) =>
    guard(reqid, () => {
      unlinkSync(real(p))
      sftp.status(reqid, STATUS_CODE.OK)
    })) as never)
  on('RENAME', ((reqid: number, from: string, to: string) =>
    guard(reqid, () => {
      renameSync(real(from), real(to))
      sftp.status(reqid, STATUS_CODE.OK)
    })) as never)
  on('SETSTAT', ((reqid: number, p: string, attrs: { mode?: number }) =>
    guard(reqid, () => {
      if (typeof attrs.mode === 'number') chmodSync(real(p), attrs.mode & 0o7777)
      sftp.status(reqid, STATUS_CODE.OK)
    })) as never)
}

/** A scripted shell: echoes input and reacts to a few commands the tests use. */
function serveShell(stream: ServerChannel): void {
  let line = ''
  stream.write('ready$ ')
  stream.on('data', (chunk: Buffer) => {
    for (const ch of chunk.toString('utf8')) {
      if (ch !== '\r') {
        line += ch
        stream.write(ch)
        continue
      }
      const cmd = line
      line = ''
      stream.write('\r\n')
      if (cmd === 'exit') {
        stream.exit(3)
        stream.end()
        return
      }
      if (cmd === 'flood') {
        const block = 'a'.repeat(65_536)
        for (let i = 0; i < 24; i++) stream.write(block)
        stream.write('FLOOD-DONE\r\n')
      } else if (cmd === 'split') {
        stream.write(Buffer.from([0xc4])) // first half of "ğ"
        setTimeout(() => stream.write(Buffer.concat([Buffer.from([0x9f, 0x0d, 0x0a]), Buffer.from('ready$ ')])), 30)
        return // the prompt follows the second half
      } else {
        stream.write(`ok:${cmd}\r\n`)
      }
      stream.write('ready$ ')
    }
  })
}

export function startTestServer(): Promise<TestServer> {
  const root = mkdtempSync(join(tmpdir(), 'sm-sftp-'))
  const { private: hostKey } = utils.generateKeyPairSync('ed25519')
  const seen: TestServer['seen'] = { windows: [], connections: 0, closed: 0 }
  const live = new Set<Connection>()

  const server = new Server({ hostKeys: [hostKey] }, (client: Connection) => {
    seen.connections++
    live.add(client)
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === TEST_USER && ctx.password === TEST_PASSWORD) ctx.accept()
      else ctx.reject(['password'])
    })
    client.on('error', () => undefined)
    client.on('close', () => {
      seen.closed++
      live.delete(client)
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (acc, _rej, info) => {
          seen.pty = info
          acc?.()
        })
        session.on('window-change', (acc, _rej, info) => {
          seen.windows.push(info)
          acc?.()
        })
        session.on('shell', (acc) => serveShell(acc()))
        session.on('sftp', (acc) => serveSftp(acc() as unknown as SftpServerStream, root))
      })
    })
  })

  return new Promise<TestServer>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolve({
        port,
        root,
        seen,
        connect: () =>
          new Promise<Client>((res, rej) => {
            const c = new Client()
            c.once('ready', () => res(c)).once('error', rej)
            c.connect({ host: '127.0.0.1', port, username: TEST_USER, password: TEST_PASSWORD, readyTimeout: 5000 })
          }),
        close: () =>
          new Promise<void>((res) => {
            for (const c of live) c.end()
            server.close(() => res())
            rmSync(root, { recursive: true, force: true })
          })
      })
    })
  })
}
