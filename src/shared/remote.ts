/** Types shared by the main process, the preload bridge and the renderer for the terminal and the file manager. */

export type TermState = 'connecting' | 'open' | 'closed'
export type CursorStyle = 'block' | 'bar' | 'underline'
export type FontChoice = 'jetbrains' | 'system'
export type RightClick = 'menu' | 'paste'

export interface TerminalSettings {
  /** Id of one of the themes in the renderer's theme list. */
  theme: string
  fontSize: number
  font: FontChoice
  cursor: CursorStyle
  cursorBlink: boolean
  scrollback: number
  /** Copy the selection to the clipboard as soon as it is made (PuTTY / Termius style). */
  copyOnSelect: boolean
  /** What a right click does: open a menu, or copy the selection / paste. */
  rightClick: RightClick
}

export const DEFAULT_TERMINAL: TerminalSettings = {
  theme: 'ash',
  fontSize: 14,
  font: 'jetbrains',
  cursor: 'block',
  cursorBlink: true,
  scrollback: 5000,
  copyOnSelect: false,
  rightClick: 'menu'
}

export const FONT_MIN = 9
export const FONT_MAX = 28

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback

/** Settings come from a file the user can edit: clamp / default everything so a bad value can never break the terminal. */
export function normalizeTerminal(raw: unknown): TerminalSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof TerminalSettings, unknown>>
  const d = DEFAULT_TERMINAL
  return {
    theme: typeof r.theme === 'string' && r.theme ? r.theme : d.theme,
    fontSize: num(r.fontSize, FONT_MIN, FONT_MAX, d.fontSize),
    font: r.font === 'system' ? 'system' : 'jetbrains',
    cursor: r.cursor === 'bar' || r.cursor === 'underline' ? r.cursor : 'block',
    cursorBlink: typeof r.cursorBlink === 'boolean' ? r.cursorBlink : d.cursorBlink,
    scrollback: num(r.scrollback, 500, 50_000, d.scrollback),
    copyOnSelect: typeof r.copyOnSelect === 'boolean' ? r.copyOnSelect : d.copyOnSelect,
    rightClick: r.rightClick === 'paste' ? 'paste' : 'menu'
  }
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface TermStateEvent {
  id: string
  state: TermState
  /** Why the session ended or could not start (English key, translated in the UI). */
  error?: string
  /** Remote shell exit code, when it closed normally. */
  code?: number | null
}

export interface TermApi {
  /** Opens a shell. The renderer picks the id so it can listen before the first byte arrives. */
  open(id: string, serverId: string, cols: number, rows: number): Promise<Result<null>>
  input(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  /** Tells the main process that `n` characters were rendered (flow control for huge outputs). */
  ack(id: string, n: number): void
  close(id: string): void
  onData(cb: (id: string, data: string) => void): () => void
  onState(cb: (e: TermStateEvent) => void): () => void
}

export type EntryKind = 'dir' | 'file' | 'link' | 'other'

export interface SftpEntry {
  name: string
  kind: EntryKind
  /** For symlinks: the target is a directory. */
  linkToDir?: boolean
  size: number
  /** Epoch ms. */
  mtime: number
  /** Unix permission bits (e.g. 0o755). */
  mode: number
  uid: number
  gid: number
}

export interface SftpListing {
  /** Resolved absolute path. */
  path: string
  entries: SftpEntry[]
}

export type TransferState = 'running' | 'done' | 'error' | 'cancelled'

export interface Transfer {
  id: string
  serverId: string
  direction: 'up' | 'down'
  /** File or folder name shown in the list. */
  name: string
  /** Remote directory (upload) or local directory (download) it goes to. */
  target: string
  done: number
  total: number
  files: number
  state: TransferState
  error?: string
}

export interface SftpApi {
  /** `null` = the user's home directory. */
  list(serverId: string, path: string | null): Promise<Result<SftpListing>>
  mkdir(serverId: string, path: string): Promise<Result<null>>
  /** Creates an empty file (fails if it already exists). */
  create(serverId: string, path: string): Promise<Result<null>>
  rename(serverId: string, from: string, to: string): Promise<Result<null>>
  remove(serverId: string, paths: string[]): Promise<Result<null>>
  chmod(serverId: string, path: string, mode: number): Promise<Result<null>>
  readText(serverId: string, path: string): Promise<Result<{ text: string; size: number }>>
  writeText(serverId: string, path: string, text: string): Promise<Result<null>>
  /** Asks where to save (native dialog) and downloads files and folders. Resolves once the transfers started. */
  download(serverId: string, paths: string[]): Promise<Result<{ started: number }>>
  /** Opens a native picker for files or a folder and uploads the selection into `remoteDir`. */
  uploadPick(serverId: string, remoteDir: string, kind: 'files' | 'folder'): Promise<Result<{ started: number }>>
  /** Uploads local paths (drag and drop). */
  upload(serverId: string, remoteDir: string, localPaths: string[]): Promise<Result<{ started: number }>>
  cancel(transferId: string): void
  /** Local path of a dropped `File` (Electron 32+ no longer exposes `file.path`). */
  pathForFile(file: File): string
  onTransfer(cb: (t: Transfer) => void): () => void
}

export interface ClipboardApi {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
}

/** Limits enforced by the main process. */
export const REMOTE_LIMITS = {
  maxTerminals: 16,
  /** Largest text file the built-in editor opens. */
  maxEditBytes: 2 * 1024 * 1024,
  /** Output not yet rendered by the UI above which the remote stream is paused. */
  maxUnacked: 512 * 1024
} as const

/** POSIX path helpers for the remote side (the renderer cannot import node's `path`). */
export const posix = {
  join(dir: string, name: string): string {
    return dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`
  },
  dirname(p: string): string {
    const t = p.replace(/\/+$/, '')
    const i = t.lastIndexOf('/')
    return i <= 0 ? '/' : t.slice(0, i)
  },
  basename(p: string): string {
    return p.replace(/\/+$/, '').split('/').pop() ?? ''
  },
  /** "/a/b" -> ["/", "/a", "/a/b"] for breadcrumbs. */
  trail(p: string): string[] {
    const parts = p.split('/').filter(Boolean)
    return ['/', ...parts.map((_, i) => `/${parts.slice(0, i + 1).join('/')}`)]
  }
}

/** "rwxr-xr-x" for a mode, like `ls -l`. */
export function modeString(mode: number): string {
  const bits = 'rwxrwxrwx'
  let s = ''
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits[i] : '-'
  return s
}
