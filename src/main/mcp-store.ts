import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_PORT, DEFAULT_POLICY, sanitizeCaps, sanitizePolicy } from '@shared/mcp'
import type { AuditEntry, Capabilities, McpClientView, NewClientInput, Policy } from '@shared/mcp'

interface StoredClient extends McpClientView {
  /** SHA-256 of the token. The token itself is shown once, when created, and never stored. */
  tokenHash: string
}

interface StoredConfig {
  enabled: boolean
  port: number
  clients: StoredClient[]
  policy: Policy
}

const MAX_CLIENTS = 50
const MAX_AUDIT_BYTES = 2 * 1024 * 1024
const AUDIT_KEEP_LINES = 1500

export class McpError extends Error {}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const newToken = (): string => `smcp_${randomBytes(32).toString('base64url')}`
const strip = ({ tokenHash: _h, ...view }: StoredClient): McpClientView => view

/** Everything MCP needs to remember: the on/off switch, agents (hashed tokens), the command policy and the audit log. */
export class McpStore {
  private cfg: StoredConfig
  private saveTimer: NodeJS.Timeout | undefined
  private readonly file: string
  private readonly auditFile: string

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now
  ) {
    this.file = join(dir, 'mcp.json')
    this.auditFile = join(dir, 'mcp-audit.jsonl')
    this.cfg = this.load()
  }

  // ---------------------------------------------------------------- persistence
  private load(): StoredConfig {
    const fresh: StoredConfig = { enabled: false, port: DEFAULT_PORT, clients: [], policy: { ...DEFAULT_POLICY } }
    try {
      if (!existsSync(this.file)) return fresh
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredConfig>
      const clients = Array.isArray(raw.clients)
        ? raw.clients.filter((c) => c && typeof c.id === 'string' && typeof c.tokenHash === 'string').slice(0, MAX_CLIENTS)
        : []
      return {
        enabled: raw.enabled === true,
        port: this.validPort(raw.port) ?? DEFAULT_PORT,
        clients: clients.map((c) => ({
          id: c.id,
          name: String(c.name ?? 'agent').slice(0, 60),
          tokenHash: c.tokenHash,
          tokenPrefix: String(c.tokenPrefix ?? ''),
          createdAt: Number(c.createdAt) || 0,
          enabled: c.enabled !== false,
          servers: c.servers === 'all' ? 'all' : Array.isArray(c.servers) ? c.servers.filter((s) => typeof s === 'string') : [],
          caps: sanitizeCaps(c.caps),
          lastSeen: typeof c.lastSeen === 'number' ? c.lastSeen : undefined,
          calls: Number(c.calls) || 0,
          clientInfo:
            c.clientInfo && typeof c.clientInfo.name === 'string'
              ? { name: c.clientInfo.name, version: String(c.clientInfo.version ?? '') }
              : undefined
        })),
        policy: sanitizePolicy(raw.policy)
      }
    } catch {
      return fresh // a corrupt file must never lock the user out of the app
    }
  }

  private write(): void {
    mkdirSync(this.dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.cfg, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.file)
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    this.write()
  }

  /** For high-frequency updates (last seen, call counters): written at most every few seconds. */
  private saveSoon(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.write()
    }, 4000)
  }

  flush(): void {
    if (this.saveTimer) this.save()
  }

  // ---------------------------------------------------------------- settings
  private validPort(p: unknown): number | null {
    return typeof p === 'number' && Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : null
  }

  get enabled(): boolean {
    return this.cfg.enabled
  }
  get port(): number {
    return this.cfg.port
  }
  get policy(): Policy {
    return this.cfg.policy
  }
  clients(): McpClientView[] {
    return this.cfg.clients.map(strip)
  }

  setEnabled(on: boolean): void {
    this.cfg.enabled = on
    this.save()
  }

  setPort(port: unknown): void {
    const p = this.validPort(port)
    if (p === null) throw new McpError('Port must be between 1024 and 65535')
    this.cfg.port = p
    this.save()
  }

  setPolicy(input: unknown): Policy {
    this.cfg.policy = sanitizePolicy(input)
    this.save()
    return this.cfg.policy
  }

  // ---------------------------------------------------------------- agents
  private find(id: string): StoredClient {
    const c = this.cfg.clients.find((x) => x.id === id)
    if (!c) throw new McpError('Unknown agent')
    return c
  }

  private cleanName(name: unknown, ignoreId?: string): string {
    const n = typeof name === 'string' ? name.trim().slice(0, 60) : ''
    if (!n) throw new McpError('Agent name is required')
    if (this.cfg.clients.some((c) => c.id !== ignoreId && c.name.toLowerCase() === n.toLowerCase()))
      throw new McpError('An agent with this name already exists')
    return n
  }

  private cleanServers(servers: unknown): 'all' | string[] {
    if (servers === 'all') return 'all'
    return Array.isArray(servers) ? [...new Set(servers.filter((s): s is string => typeof s === 'string'))] : []
  }

  createClient(input: NewClientInput): { client: McpClientView; token: string } {
    if (this.cfg.clients.length >= MAX_CLIENTS) throw new McpError('Too many agents')
    const token = newToken()
    const c: StoredClient = {
      id: randomUUID(),
      name: this.cleanName(input.name),
      tokenHash: sha(token),
      tokenPrefix: token.slice(0, 9),
      createdAt: this.now(),
      enabled: true,
      servers: this.cleanServers(input.servers),
      caps: sanitizeCaps(input.caps),
      calls: 0
    }
    this.cfg.clients.push(c)
    this.save()
    return { client: strip(c), token }
  }

  updateClient(id: string, patch: { name?: string; enabled?: boolean; servers?: 'all' | string[]; caps?: Capabilities }): McpClientView {
    const c = this.find(id)
    if (patch.name !== undefined) c.name = this.cleanName(patch.name, id)
    if (typeof patch.enabled === 'boolean') c.enabled = patch.enabled
    if (patch.servers !== undefined) c.servers = this.cleanServers(patch.servers)
    if (patch.caps !== undefined) c.caps = sanitizeCaps(patch.caps)
    this.save()
    return strip(c)
  }

  rotateToken(id: string): { client: McpClientView; token: string } {
    const c = this.find(id)
    const token = newToken()
    c.tokenHash = sha(token)
    c.tokenPrefix = token.slice(0, 9)
    this.save()
    return { client: strip(c), token }
  }

  deleteClient(id: string): void {
    this.find(id)
    this.cfg.clients = this.cfg.clients.filter((c) => c.id !== id)
    this.save()
  }

  /** Forget servers that no longer exist so an agent's scope never points at nothing. */
  pruneServers(existing: string[]): void {
    let changed = false
    for (const c of this.cfg.clients) {
      if (c.servers === 'all') continue
      const kept = c.servers.filter((s) => existing.includes(s))
      if (kept.length !== c.servers.length) {
        c.servers = kept
        changed = true
      }
    }
    if (changed) this.save()
  }

  /** Looks a bearer token up. Compares hashes in constant time and against every agent (no early exit). */
  authenticate(token: string): StoredClient | null {
    const h = Buffer.from(sha(token), 'hex')
    let found: StoredClient | null = null
    for (const c of this.cfg.clients) {
      const ok = timingSafeEqual(h, Buffer.from(c.tokenHash, 'hex'))
      if (ok) found = c
    }
    return found
  }

  touch(id: string, opts: { call?: boolean; info?: { name: string; version: string } } = {}): void {
    const c = this.cfg.clients.find((x) => x.id === id)
    if (!c) return
    c.lastSeen = this.now()
    if (opts.call) c.calls++
    if (opts.info) c.clientInfo = { name: opts.info.name.slice(0, 60), version: opts.info.version.slice(0, 30) }
    this.saveSoon()
  }

  view(): { enabled: boolean; port: number; clients: McpClientView[]; policy: Policy } {
    return { enabled: this.cfg.enabled, port: this.cfg.port, clients: this.clients(), policy: this.cfg.policy }
  }

  // ---------------------------------------------------------------- audit log (JSON lines, newest last)
  audit(entry: Omit<AuditEntry, 'ts'>): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      appendFileSync(this.auditFile, JSON.stringify({ ts: this.now(), ...entry }) + '\n', { encoding: 'utf8', mode: 0o600 })
      if (statSync(this.auditFile).size > MAX_AUDIT_BYTES) {
        const lines = readFileSync(this.auditFile, 'utf8').split('\n').filter(Boolean)
        writeFileSync(this.auditFile, lines.slice(-AUDIT_KEEP_LINES).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
      }
    } catch {
      /* the audit log must never break a tool call */
    }
  }

  readAudit(limit = 200): AuditEntry[] {
    try {
      if (!existsSync(this.auditFile)) return []
      const out: AuditEntry[] = []
      for (const line of readFileSync(this.auditFile, 'utf8').split('\n')) {
        if (!line) continue
        try {
          out.push(JSON.parse(line) as AuditEntry)
        } catch {
          /* skip a torn line */
        }
      }
      return out.slice(-limit).reverse()
    } catch {
      return []
    }
  }

  clearAudit(): void {
    writeFileSync(this.auditFile, '', { encoding: 'utf8', mode: 0o600 })
  }
}
