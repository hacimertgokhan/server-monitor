import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { SafeJson } from './safe-json'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Availability, ServerInfo, ServerInput, Settings } from '@shared/types'

interface Secret {
  password?: string
  passphrase?: string
}

interface StoredServer extends ServerInfo {
  secret?: string // base64(safeStorage.encryptString(JSON.stringify(Secret)))
  hostKey?: string // trust-on-first-use SHA-256 host key fingerprint
}

export interface ServerSecrets extends ServerInfo, Secret {
  hostKey?: string
}

/** Unreadable files are retried, restored from `.bak` or left untouched; writes keep a `.bak` copy (see safe-json.ts). */
const json = new SafeJson(() => app.getPath('userData'))

const readJson = <T>(name: string, fallback: T): T => json.read(name, fallback)
const writeJson = (name: string, data: unknown): void => void json.write(name, data, { backup: name !== 'uptime.json' })

/** Data files that could not be read at startup. They stay untouched on disk; the UI offers a retry. */
export const dataProblems = (): string[] => [...json.problems]

/** Reads servers and settings again (the "Retry" button after a failed start). */
export function reloadData(): void {
  json.clearProblems()
  loadServers()
  loadSettings()
}

/** Shown in the UI (translated there). */
export const SECURE_STORAGE_MISSING =
  'Secure credential storage is not available on this system. On Linux install a keyring (GNOME Keyring or KWallet), or use an SSH key without a passphrase.'

function seal(secret: Secret): string | undefined {
  if (!secret.password && !secret.passphrase) return undefined
  // On Linux without a keyring Electron silently falls back to a hard-coded key ('basic_text'): that is not encryption.
  const weak = process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text'
  if (!safeStorage.isEncryptionAvailable() || weak) {
    throw new Error(SECURE_STORAGE_MISSING)
  }
  return safeStorage.encryptString(JSON.stringify(secret)).toString('base64')
}

function unseal(s?: string): Secret {
  if (!s) return {}
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(s, 'base64'))) as Secret
  } catch {
    return {}
  }
}

const toInfo = ({ secret: _s, hostKey: _h, ...info }: StoredServer): ServerInfo => info

// ---------------------------------------------------------------- servers
let servers: StoredServer[] = []

export function loadServers(): void {
  servers = readJson<StoredServer[]>('servers.json', [])
}

export const listServers = (): ServerInfo[] => servers.map(toInfo)

export function getSecrets(id: string): ServerSecrets | undefined {
  const s = servers.find((x) => x.id === id)
  if (!s) return undefined
  return { ...toInfo(s), ...unseal(s.secret), hostKey: s.hostKey }
}

export const DATA_UNREADABLE = 'Your saved servers could not be read, so changes are blocked to protect them. Press Retry first.'

export function upsertServer(input: ServerInput): ServerInfo {
  if (json.problems.has('servers.json')) throw new Error(DATA_UNREADABLE)
  const existing = input.id ? servers.find((s) => s.id === input.id) : undefined
  const prevSecret = unseal(existing?.secret)
  const secret: Secret = {
    // Empty password/passphrase on edit = keep the stored one.
    password: input.authType === 'password' ? input.password || prevSecret.password : undefined,
    passphrase: input.authType === 'key' ? input.passphrase || prevSecret.passphrase : undefined
  }
  const hostChanged = existing && (existing.host !== input.host || existing.port !== input.port)
  const rec: StoredServer = {
    id: existing?.id ?? randomUUID(),
    name: input.name.trim() || input.host,
    host: input.host.trim(),
    port: input.port || 22,
    username: input.username.trim(),
    authType: input.authType,
    keyPath: input.authType === 'key' ? input.keyPath : undefined,
    secret: seal(secret),
    hostKey: hostChanged ? undefined : existing?.hostKey
  }
  servers = existing ? servers.map((s) => (s.id === rec.id ? rec : s)) : [...servers, rec]
  writeJson('servers.json', servers)
  return toInfo(rec)
}

export function removeServer(id: string): void {
  if (json.problems.has('servers.json')) throw new Error(DATA_UNREADABLE)
  servers = servers.filter((s) => s.id !== id)
  writeJson('servers.json', servers)
  delete uptime[id]
  flushUptime()
}

export function pinHostKey(id: string, fingerprint: string): void {
  const s = servers.find((x) => x.id === id)
  if (!s) return
  s.hostKey = fingerprint
  writeJson('servers.json', servers)
}

// ---------------------------------------------------------------- settings
let settings: Settings = { ...DEFAULT_SETTINGS }

export function loadSettings(): Settings {
  // Linux desktops often have no tray (GNOME), so hiding to it would make the app unreachable: default to real quit there.
  const platformDefaults: Partial<Settings> = { closeToTray: process.platform !== 'linux' }
  settings = { ...DEFAULT_SETTINGS, ...platformDefaults, ...readJson<Partial<Settings>>('settings.json', {}) }
  return settings
}

export const getSettings = (): Settings => settings

let settingsTimer: NodeJS.Timeout | undefined

/** Applies immediately, writes to disk debounced (sliders/drags patch many times per second). */
export function patchSettings(patch: Partial<Settings>): Settings {
  settings = { ...settings, ...patch }
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(flushSettings, 250)
  return settings
}

export function flushSettings(): void {
  if (!settingsTimer) return
  clearTimeout(settingsTimer)
  settingsTimer = undefined
  writeJson('settings.json', settings)
}

// ---------------------------------------------------------------- uptime tracking
// Hourly buckets: [okChecks, totalChecks]. Only measured while this app is running.
type Buckets = Record<string, [number, number]>
interface UptimeFile {
  since: number
  servers: Record<string, Buckets>
  incidents: Record<string, number[]> // start timestamps of outages
}

const HOUR = 3_600_000
const raw = { since: 0, servers: {}, incidents: {} } as UptimeFile
let uptime: Record<string, Buckets> = raw.servers
let dirty = false
let timer: NodeJS.Timeout | undefined

export function loadUptime(): void {
  const u = readJson<UptimeFile>('uptime.json', { since: Date.now(), servers: {}, incidents: {} })
  raw.since = u.since || Date.now()
  raw.servers = uptime = u.servers || {}
  raw.incidents = u.incidents || {}
  timer = setInterval(flushUptime, 30_000)
}

export function flushUptime(): void {
  if (!dirty) return
  dirty = false
  writeJson('uptime.json', raw)
}

export function stopUptime(): void {
  if (timer) clearInterval(timer)
  dirty = true
  flushUptime()
}

const downSince = new Map<string, number>()

export function recordCheck(id: string, ok: boolean): void {
  const b = (uptime[id] ??= {})
  const key = String(Math.floor(Date.now() / HOUR) * HOUR)
  const cell = (b[key] ??= [0, 0])
  cell[1]++
  if (ok) cell[0]++
  // prune > 31d
  const cutoff = Date.now() - 31 * 24 * HOUR
  for (const k of Object.keys(b)) if (Number(k) < cutoff) delete b[k]

  const wasDown = downSince.has(id)
  if (!ok && !wasDown) {
    downSince.set(id, Date.now())
    ;(raw.incidents[id] ??= []).push(Date.now())
    raw.incidents[id] = raw.incidents[id].filter((t) => t > cutoff)
  } else if (ok && wasDown) {
    downSince.delete(id)
  }
  dirty = true
}

function pct(b: Buckets | undefined, windowMs: number): number | null {
  if (!b) return null
  const from = Date.now() - windowMs
  let ok = 0
  let total = 0
  for (const [k, [o, t]] of Object.entries(b)) {
    if (Number(k) + HOUR >= from) {
      ok += o
      total += t
    }
  }
  return total ? (ok / total) * 100 : null
}

export function availability(id: string): Availability {
  const b = uptime[id]
  const day = Date.now() - 24 * HOUR
  return {
    pct24h: pct(b, 24 * HOUR),
    pct7d: pct(b, 7 * 24 * HOUR),
    pct30d: pct(b, 30 * 24 * HOUR),
    incidents24h: (raw.incidents[id] ?? []).filter((t) => t > day).length,
    trackedSince: raw.since,
    downSince: downSince.get(id)
  }
}
