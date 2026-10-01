/**
 * Fake terminal and file manager for the demo servers (browser preview and "Preview with demo"), so Root mode can
 * be tried without a server. Nothing here touches the network; real servers use the Electron backend instead.
 */
import { posix } from '@shared/remote'
import type { ClipboardApi, Result, SftpApi, SftpEntry, TermApi, TermStateEvent, Transfer } from '@shared/remote'

const ESC = '\x1b'
const C = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  inv: `${ESC}[7m`
}

// ------------------------------------------------------------------ in-memory file system
interface DemoNode {
  kind: 'dir' | 'file'
  text?: string
  size: number
  mtime: number
  mode: number
}

const NOW = Date.now()
const DAY = 86_400_000
const fs = new Map<string, DemoNode>()
const dir = (p: string, ago = 3): void => void fs.set(p, { kind: 'dir', size: 4096, mtime: NOW - ago * DAY, mode: 0o755 })
const file = (p: string, text: string, ago = 1, mode = 0o644, size?: number): void =>
  void fs.set(p, { kind: 'file', text, size: size ?? text.length, mtime: NOW - ago * DAY, mode })

dir('/')
dir('/home')
dir('/home/demo')
dir('/home/demo/projects')
dir('/home/demo/projects/api', 1)
dir('/home/demo/projects/api/src', 1)
dir('/home/demo/logs', 0)
dir('/home/demo/.ssh', 30)
file('/home/demo/.bashrc', '# ~/.bashrc\nexport PATH="$HOME/.local/bin:$PATH"\nalias ll="ls -alF"\n', 30)
file(
  '/home/demo/notes.txt',
  'Server notes\n============\n- renew the TLS certificate (due in 12 days)\n- rotate the deploy key\n- upgrade Postgres to 17\n',
  2
)
file(
  '/home/demo/projects/api/package.json',
  '{\n  "name": "api",\n  "version": "1.4.2",\n  "scripts": { "start": "node src/index.js" }\n}\n',
  1
)
file('/home/demo/projects/api/README.md', '# API\n\nRun with `pm2 start ecosystem.config.js`.\n', 5)
file('/home/demo/projects/api/src/index.js', "const http = require('http')\nhttp.createServer((_, res) => res.end('ok')).listen(3000)\n", 1)
file('/home/demo/projects/api/ecosystem.config.js', "module.exports = { apps: [{ name: 'api', script: 'src/index.js' }] }\n", 4)
file(
  '/home/demo/logs/app.log',
  Array.from({ length: 14 }, (_, i) => `2026-10-01T09:${String(10 + i).padStart(2, '0')}:12Z INFO request GET /health 200 ${3 + i}ms`).join(
    '\n'
  ) + '\n',
  0
)
file('/home/demo/logs/error.log', '2026-10-01T08:41:03Z WARN slow query (812ms)\n', 0)
file('/home/demo/backup.tar.gz', '', 6, 0o644, 48_300_000)
file('/etc/hostname', 'demo-server\n', 90)

const kids = (p: string): string[] =>
  [...fs.keys()].filter((k) => k !== p && posix.dirname(k) === p && k !== '/').map((k) => posix.basename(k))

const entry = (path: string, name: string): SftpEntry => {
  const n = fs.get(posix.join(path, name))!
  return { name, kind: n.kind === 'dir' ? 'dir' : 'file', size: n.size, mtime: n.mtime, mode: n.mode, uid: 1000, gid: 1000 }
}

const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const err = (error: string): { ok: false; error: string } => ({ ok: false, error })
const delay = <T>(v: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms))

// ------------------------------------------------------------------ SFTP
const transferListeners = new Set<(t: Transfer) => void>()

function fakeTransfer(serverId: string, direction: 'up' | 'down', name: string, target: string, total: number): void {
  const t: Transfer = { id: crypto.randomUUID(), serverId, direction, name, target, done: 0, total, files: 1, state: 'running' }
  const push = (): void => transferListeners.forEach((cb) => cb({ ...t }))
  push()
  const timer = setInterval(() => {
    t.done = Math.min(total, t.done + Math.ceil(total / 12))
    if (t.done >= total) {
      t.state = 'done'
      clearInterval(timer)
    }
    push()
  }, 180)
}

const demoSftp: SftpApi = {
  list: async (_s, path) => {
    const p = path ?? '/home/demo'
    const n = fs.get(p)
    if (!n) return err('No such file or folder')
    if (n.kind !== 'dir') return err('This is a folder')
    return delay(ok({ path: p, entries: kids(p).map((name) => entry(p, name)) }))
  },
  mkdir: async (_s, p) => (fs.has(p) ? err('Operation failed (does it already exist?)') : (dir(p, 0), ok(null))),
  create: async (_s, p) => (fs.has(p) ? err('Operation failed (does it already exist?)') : (file(p, '', 0), ok(null))),
  rename: async (_s, from, to) => {
    if (!fs.has(from)) return err('No such file or folder')
    if (fs.has(to)) return err('Operation failed (does it already exist?)')
    for (const k of [...fs.keys()]) {
      if (k === from || k.startsWith(`${from}/`)) {
        fs.set(to + k.slice(from.length), fs.get(k)!)
        fs.delete(k)
      }
    }
    return ok(null)
  },
  remove: async (_s, paths) => {
    for (const p of paths) for (const k of [...fs.keys()]) if (k === p || k.startsWith(`${p}/`)) fs.delete(k)
    return ok(null)
  },
  chmod: async (_s, p, mode) => {
    const n = fs.get(p)
    if (!n) return err('No such file or folder')
    n.mode = mode
    return ok(null)
  },
  readText: async (_s, p) => {
    const n = fs.get(p)
    if (!n) return err('No such file or folder')
    if (n.kind === 'dir') return err('This is a folder')
    if (n.text === undefined || n.text === '' ? n.size > 0 : false) return err('This looks like a binary file')
    return ok({ text: n.text ?? '', size: n.size })
  },
  writeText: async (_s, p, text) => {
    const n = fs.get(p)
    fs.set(p, { kind: 'file', text, size: text.length, mtime: Date.now(), mode: n?.mode ?? 0o644 })
    return ok(null)
  },
  download: async (s, paths) => {
    for (const p of paths) fakeTransfer(s, 'down', posix.basename(p), '~/Downloads', fs.get(p)?.size || 40_000)
    return ok({ started: paths.length })
  },
  uploadPick: async (s, remoteDir, kind) => {
    const name = kind === 'folder' ? 'assets' : 'upload.zip'
    fakeTransfer(s, 'up', name, remoteDir, 3_200_000)
    if (kind === 'files') file(posix.join(remoteDir, name), '', 0, 0o644, 3_200_000)
    return ok({ started: 1 })
  },
  upload: async (s, remoteDir, localPaths) => {
    for (const lp of localPaths) {
      const name = lp.split(/[\\/]/).pop() ?? 'file'
      fakeTransfer(s, 'up', name, remoteDir, 250_000)
      file(posix.join(remoteDir, name), '', 0, 0o644, 250_000)
    }
    return ok({ started: localPaths.length })
  },
  cancel: () => undefined,
  pathForFile: (f) => f.name,
  onTransfer: (cb) => {
    transferListeners.add(cb)
    return () => transferListeners.delete(cb)
  }
}

// ------------------------------------------------------------------ terminal
interface Sess {
  line: string
  cwd: string
  host: string
  /** Fake full-screen editor ("nano") state. */
  editor?: { path: string }
  closed: boolean
}

const dataListeners = new Set<(id: string, data: string) => void>()
const stateListeners = new Set<(e: TermStateEvent) => void>()
const sessions = new Map<string, Sess>()

const emit = (id: string, data: string): void => dataListeners.forEach((cb) => cb(id, data))
const state = (e: TermStateEvent): void => stateListeners.forEach((cb) => cb(e))
const prompt = (s: Sess): string =>
  `${C.green}${C.bold}demo@${s.host}${C.reset}:${C.blue}${C.bold}${s.cwd === '/home/demo' ? '~' : s.cwd}${C.reset}$ `

function drawEditor(id: string, path: string, text: string): void {
  const lines = text.split('\n')
  let out = `${ESC}[?1049h${ESC}[2J${ESC}[H`
  out += `${C.inv}  GNU nano 7.2${' '.repeat(10)}${path}${' '.repeat(10)}${C.reset}\r\n`
  for (const l of lines.slice(0, 14)) out += `${l}\r\n`
  out += `${ESC}[22;1H${C.inv}^G${C.reset} Help   ${C.inv}^O${C.reset} Write Out   ${C.inv}^W${C.reset} Where Is   ${C.inv}^X${C.reset} Exit`
  emit(id, out)
}

function runCommand(id: string, s: Sess, raw: string): void {
  const [cmd, ...args] = raw.trim().split(/\s+/)
  const out = (t: string): void => emit(id, t.replace(/\n/g, '\r\n'))
  const resolve = (p: string): string => (p.startsWith('/') ? p : posix.join(s.cwd, p.replace(/^~/, '/home/demo')))
  switch (cmd) {
    case '':
      break
    case 'help':
      out(
        `Demo shell. Try: ${C.cyan}ls${C.reset}, ${C.cyan}cat notes.txt${C.reset}, ${C.cyan}nano notes.txt${C.reset}, ${C.cyan}uname -a${C.reset}, ${C.cyan}htop${C.reset}, ${C.cyan}clear${C.reset}, ${C.cyan}exit${C.reset}\n`
      )
      out(`${C.dim}A real server gives you a full PTY: nano, vim, htop and tmux all work.${C.reset}\n`)
      break
    case 'ls': {
      const target = args.find((a) => !a.startsWith('-')) ?? '.'
      const p = target === '.' ? s.cwd : resolve(target)
      if (!fs.has(p)) return out(`ls: cannot access '${target}': No such file or directory\n`)
      out(
        kids(p)
          .sort()
          .map((k) => (fs.get(posix.join(p, k))!.kind === 'dir' ? `${C.blue}${C.bold}${k}${C.reset}` : k))
          .join('  ') + '\n'
      )
      break
    }
    case 'cd': {
      const p = args[0] ? resolve(args[0]) : '/home/demo'
      if (fs.get(p)?.kind === 'dir') s.cwd = p
      else out(`bash: cd: ${args[0]}: No such file or directory\n`)
      break
    }
    case 'pwd':
      out(`${s.cwd}\n`)
      break
    case 'whoami':
      out('demo\n')
      break
    case 'uname':
      out(`Linux ${s.host} 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux\n`)
      break
    case 'date':
      out(`${new Date().toUTCString()}\n`)
      break
    case 'uptime':
      out(' 09:42:11 up 41 days,  3:12,  1 user,  load average: 0.21, 0.34, 0.29\n')
      break
    case 'cat': {
      const n = args[0] ? fs.get(resolve(args[0])) : undefined
      if (!n) out(`cat: ${args[0] ?? ''}: No such file or directory\n`)
      else out(n.text ?? '')
      break
    }
    case 'nano':
    case 'vim': {
      const path = resolve(args[0] ?? 'untitled.txt')
      s.editor = { path }
      drawEditor(id, path, fs.get(path)?.text ?? '')
      return // no prompt while the editor is open
    }
    case 'htop':
    case 'top':
      out(`${C.dim}(demo) top - 09:42:11 up 41 days, 3 users, load average: 0.21, 0.34, 0.29${C.reset}\n`)
      out(
        `  PID USER      %CPU %MEM COMMAND\n 1432 demo      ${C.yellow}12.4${C.reset}  3.1 node\n  881 root       ${C.green}0.7${C.reset}  1.2 dockerd\n`
      )
      break
    case 'clear':
      emit(id, `${ESC}[2J${ESC}[H`)
      break
    case 'exit':
      out('logout\n')
      s.closed = true
      sessions.delete(id)
      state({ id, state: 'closed', code: 0 })
      return
    default:
      out(`${cmd}: command not found\n`)
  }
  emit(id, prompt(s))
}

function typed(id: string, s: Sess, data: string): void {
  if (s.editor) {
    if (data === '\x18') {
      // Ctrl+X leaves the fake editor
      s.editor = undefined
      emit(id, `${ESC}[?1049l${prompt(s)}`)
    }
    return
  }
  for (const ch of data) {
    if (ch === '\r') {
      emit(id, '\r\n')
      const line = s.line
      s.line = ''
      runCommand(id, s, line)
    } else if (ch === '\x7f') {
      if (s.line) {
        s.line = s.line.slice(0, -1)
        emit(id, '\b \b')
      }
    } else if (ch === '\x03') {
      s.line = ''
      emit(id, `^C\r\n${prompt(s)}`)
    } else if (ch >= ' ') {
      s.line += ch
      emit(id, ch)
    }
  }
}

const demoTerm: TermApi = {
  open: async (id, serverId) => {
    const host = serverId.replace(/^demo-/, '') || 'server'
    const s: Sess = { line: '', cwd: '/home/demo', host, closed: false }
    sessions.set(id, s)
    state({ id, state: 'connecting' })
    setTimeout(() => {
      if (s.closed || !sessions.has(id)) return
      state({ id, state: 'open' })
      emit(id, `${C.dim}Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)${C.reset}\r\n`)
      emit(id, `${C.dim}Demo terminal: type ${C.reset}${C.cyan}help${C.reset}${C.dim} to look around.${C.reset}\r\n\r\n`)
      emit(id, prompt(s))
    }, 350)
    return ok(null)
  },
  input: (id, data) => {
    const s = sessions.get(id)
    if (s) typed(id, s, data)
  },
  resize: () => undefined,
  ack: () => undefined,
  close: (id) => void sessions.delete(id),
  onData: (cb) => {
    dataListeners.add(cb)
    return () => dataListeners.delete(cb)
  },
  onState: (cb) => {
    stateListeners.add(cb)
    return () => stateListeners.delete(cb)
  }
}

const demoClipboard: ClipboardApi = {
  readText: async () => {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  },
  writeText: async (text) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard not available in this context */
    }
  }
}

export const demoRemote = { term: demoTerm, sftp: demoSftp, clipboard: demoClipboard }
