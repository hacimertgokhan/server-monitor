export type AuthType = 'password' | 'key'
export type AppMode = 'window' | 'mini' | 'wallpaper'
export type LayoutMode = 'radial' | 'grid' | 'free'
export type Language = 'auto' | 'en' | 'tr'
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
  /** Free-layout positions, keyed by server id (and 'hub'). */
  positions: Record<string, { x: number; y: number }>
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

export interface Api {
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
  positions: {}
}
