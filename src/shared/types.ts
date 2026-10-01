import type { AuditEntry, Capabilities, McpState, NewClientInput, Policy } from './mcp'
import { DEFAULT_TERMINAL } from './remote'
import type { ClipboardApi, SftpApi, TermApi, TerminalSettings } from './remote'
export type AuthType = 'password' | 'key'
export type AppMode = 'window' | 'mini' | 'wallpaper'
export type LayoutMode = 'radial' | 'grid' | 'free'
export type Language = 'auto' | 'en' | 'tr'
/** Sub-tree groups that can be expanded under a server card. */
export type GroupKey = 'docker' | 'pm2' | 'services' | 'ports'
/** 'few' shows the most relevant items, 'all' shows every item. */
export type ExpandMode = 'few' | 'all'
export type ExpandedGroups = Partial<Record<GroupKey, ExpandMode>>
export type ConnState = 'connecting' | 'online' | 'offline'

/** What the user types in the "add server" form. Secrets never leave the main process again. */
export interface ServerInput {
  id?: string
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  password?: string
  keyPath?: string
  passphrase?: string
}

/** Non-secret view of a server, safe to send to the renderer. */
export interface ServerInfo {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  keyPath?: string
}

export interface DiskInfo {
  mount: string
  fs: string
  size: number
  used: number
  pct: number
}

export interface ContainerInfo {
  name: string
  image: string
  state: string
  status: string
}

export interface Pm2Proc {
  name: string
  status: string
  cpu: number
  memory: number
  restarts: number
  uptimeMs: number
}

export interface PortInfo {
  port: number
  proto: 'tcp' | 'udp'
  exposure: 'public' | 'local'
  process?: string
}

export interface Availability {
  pct24h: number | null
  pct7d: number | null
  pct30d: number | null
  incidents24h: number
  trackedSince: number
  downSince?: number
}

export interface ServerStatus {
  id: string
  state: ConnState
  error?: string
  checkedAt: number
  latencyMs: number
  cpu: number
  cores: number
  load: [number, number, number]
  memTotal: number
  memUsed: number
  memPct: number
  swapTotal: number
  swapUsed: number
  netRx: number
  netTx: number
  uptimeSec: number
  os: string
  kernel: string
  hostname: string
  disks: DiskInfo[]
  docker: { available: boolean; running: number; total: number; containers: ContainerInfo[] }
  pm2: { available: boolean; daemon: boolean; online: number; total: number; procs: Pm2Proc[] }
  services: { available: boolean; running: string[]; failed: string[] }
  ports: PortInfo[]
  cpuHistory: number[]
  memHistory: number[]
  availability: Availability
}

export interface Settings {
  mode: AppMode
  pollSec: number
  closeToTray: boolean
  autoStart: boolean
  miniOnTop: boolean
  /** radial/grid arrange cards automatically; free keeps the dragged `positions`. */
  layout: LayoutMode
  /** Global card size multiplier (0.6 - 1.5). */
  cardScale: number
  /** Per-card size multiplier on top of `cardScale`, keyed by server id. */
  cardScales: Record<string, number>
  language: Language
  /** Expanded sub-trees per server id. */
  expanded: Record<string, ExpandedGroups>
  /** Desktop notifications for new problems (offline, high load, failed services ...). */
  notifications: boolean
  /** Utilisation (%) above which CPU / RAM / disk count as a problem. */
  thresholds: { cpu: number; ram: number; disk: number }
  /** Show only servers that currently have a problem. */
  problemsOnly: boolean
  /** Free-layout positions, keyed by server id (and 'hub'). */
  positions: Record<string, { x: number; y: number }>
  /** Look and behaviour of the built-in SSH terminal. */
  terminal: TerminalSettings
}

export interface AppState {
  servers: ServerInfo[]
  statuses: Record<string, ServerStatus>
  settings: Settings
}

export interface TestResult {
  ok: boolean
  error?: string
  latencyMs?: number
  os?: string
}

export type LogKind = 'docker' | 'pm2' | 'service'

export interface LogRequest {
  serverId: string
  kind: LogKind
  name: string
  /** Number of trailing lines (clamped to 10..2000 by the main process). */
  lines: number
}

export interface LogResult {
  ok: boolean
  text: string
  error?: string
  /** Epoch ms when the server answered. */
  at: number
}

export interface AppInfo {
  version: string
  platform: string
  packaged: boolean
}

export interface UpdateInfo {
  ok: boolean
  current: string
  latest?: string
  url?: string
  newer?: boolean
  error?: string
}

/** Result of an MCP management call: the new state (and a token, only when one was just created), or an error. */
export type McpResult = { ok: true; state: McpState; token?: string } | { ok: false; error: string }

export interface McpApi {
  getState(): Promise<McpState>
  setEnabled(on: boolean): Promise<McpResult>
  setPort(port: number): Promise<McpResult>
  createAgent(input: NewClientInput): Promise<McpResult>
  updateAgent(id: string, patch: { name?: string; enabled?: boolean; servers?: 'all' | string[]; caps?: Capabilities }): Promise<McpResult>
  rotateToken(id: string): Promise<McpResult>
  deleteAgent(id: string): Promise<McpResult>
  setPolicy(policy: Policy): Promise<McpResult>
  getAudit(limit?: number): Promise<AuditEntry[]>
  clearAudit(): Promise<void>
  onChange(cb: (s: McpState) => void): () => void
}

export interface Api {
  mcp: McpApi
  /** Built-in SSH terminal (Root mode). */
  term: TermApi
  /** Built-in SFTP file manager (Root mode). */
  sftp: SftpApi
  clipboard: ClipboardApi
  /** Opens a link the user clicked in the terminal (http/https only, after Ctrl/Cmd+click). */
  openWebLink(url: string): Promise<void>
  /** process.platform of the host: 'win32' | 'darwin' | 'linux'. */
  platform: string
  getAppInfo(): Promise<AppInfo>
  /** Opens a whitelisted https/mailto link in the default browser / mail client. */
  openExternal(url: string): Promise<void>
  /** Asks GitHub for the latest release. Only ever runs when the user presses the button. */
  checkUpdates(): Promise<UpdateInfo>
  /** Tails a container / PM2 process / systemd unit on a server (read-only). */
  fetchLogs(req: LogRequest): Promise<LogResult>
  getState(): Promise<AppState>
  saveServer(input: ServerInput): Promise<ServerInfo>
  removeServer(id: string): Promise<void>
  testServer(input: ServerInput): Promise<TestResult>
  pickKeyFile(): Promise<string | null>
  setMode(mode: AppMode): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  hideToTray(): Promise<void>
  quit(): Promise<void>
  onStatus(cb: (s: ServerStatus) => void): () => void
  onServers(cb: (s: ServerInfo[]) => void): () => void
  onSettings(cb: (s: Settings) => void): () => void
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'window',
  pollSec: 3,
  closeToTray: true,
  autoStart: false,
  miniOnTop: true,
  layout: 'radial',
  cardScale: 1,
  cardScales: {},
  language: 'auto',
  expanded: {},
  notifications: true,
  thresholds: { cpu: 90, ram: 90, disk: 90 },
  problemsOnly: false,
  positions: {},
  terminal: DEFAULT_TERMINAL
}
