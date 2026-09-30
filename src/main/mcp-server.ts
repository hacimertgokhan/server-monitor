import http from 'http'
import type { IncomingMessage, ServerResponse } from 'http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { detectIssues } from '@shared/issues'
import type { Thresholds } from '@shared/issues'
import { evaluateCommand, verdictReason } from '@shared/mcp'
import type { AuditEntry, McpClientView } from '@shared/mcp'
import type { LogRequest, LogResult, ServerInfo, ServerStatus } from '@shared/types'
import type { ExecResult } from './monitor'
import type { McpStore } from './mcp-store'

export interface McpDeps {
  store: McpStore
  version: string
  listServers(): ServerInfo[]
  getStatus(id: string): ServerStatus | undefined
  thresholds(): Thresholds
  fetchLogs(req: LogRequest): Promise<LogResult>
  exec(serverId: string, command: string, timeoutMs: number, maxBytes: number): Promise<ExecResult>
  /** Asks the human. Must resolve to false on timeout. */
  approve(req: { clientName: string; serverName: string; command: string }): Promise<boolean>
  /** Something the UI shows changed (agent seen, call counted). */
  changed(): void
}

const MAX_BODY = 1024 * 1024
const MAX_PARALLEL_EXEC = 4

const INSTRUCTIONS = `Server Monitor gives you controlled access to the user's Linux servers over their existing SSH connections.
Start with list_servers. Use get_server_status and list_issues to look around, get_logs to read Docker / PM2 / systemd logs, and run_command only when you really need a shell.
Everything is governed by a policy the user controls: run_command may be refused (deny list / allow list), may wait for the user's approval, and every call is recorded in an audit log. Call get_policy to see the current rules. Prefer read-only diagnostics; never try to work around a refusal.`

const jsonRpcError = (message: string): string => JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null })

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }]
})
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true })

/** The local MCP endpoint: `POST http://127.0.0.1:<port>/mcp` with `Authorization: Bearer <agent token>`. */
export class McpService {
  private server: http.Server | null = null
  private _port = 0
  private _error: string | undefined
  private inflight = new Map<string, number>()
  private changedTimer: NodeJS.Timeout | undefined

  constructor(private readonly deps: McpDeps) {}

  get listening(): boolean {
    return !!this.server?.listening
  }
  get port(): number {
    return this._port
  }
  get error(): string | undefined {
    return this._error
  }
  get url(): string {
    return `http://127.0.0.1:${this._port}/mcp`
  }

  async start(port: number): Promise<void> {
    await this.stop()
    this._error = undefined
    this._port = port
    const server = http.createServer((req, res) => void this.handle(req, res))
    server.on('clientError', (_e, socket) => socket.destroy())
    this.server = server
    await new Promise<void>((resolve) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        this._error = e.code === 'EADDRINUSE' ? `Port ${port} is already in use` : e.message
        this.server = null
        resolve()
      })
      // loopback only: the endpoint is never reachable from the network
      server.listen(port, '127.0.0.1', () => resolve())
    })
    // when port 0 was requested (tests), pick up the real one
    const addr = this.server?.address()
    if (addr && typeof addr === 'object') this._port = addr.port
  }

  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    if (!s) return
    s.closeAllConnections?.()
    await new Promise<void>((resolve) => s.close(() => resolve()))
  }

  // ---------------------------------------------------------------- HTTP layer
  private notifyChanged(): void {
    if (this.changedTimer) return
    this.changedTimer = setTimeout(() => {
      this.changedTimer = undefined
      this.deps.changed()
    }, 800)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (code: number, message: string, headers: Record<string, string> = {}): void => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
      res.end(jsonRpcError(message))
    }
    try {
      // Only the exact loopback host names: blocks DNS-rebinding pages from reaching the endpoint.
      const host = String(req.headers.host ?? '').toLowerCase()
      if (![`127.0.0.1:${this._port}`, `localhost:${this._port}`, `[::1]:${this._port}`].includes(host)) return send(403, 'Forbidden host')
      // Browsers always send Origin on cross-site requests; native MCP clients never do.
      if (req.headers.origin) return send(403, 'Browser requests are not allowed')
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      if (path !== '/mcp') return send(404, 'Not found')
      if (req.method !== 'POST') return send(405, 'Method not allowed', { Allow: 'POST' })

      const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''))
      const stored = m ? this.deps.store.authenticate(m[1]) : null
      if (!stored) return send(401, 'Missing or invalid agent token', { 'WWW-Authenticate': 'Bearer realm="server-monitor"' })
      if (!stored.enabled) return send(403, 'This agent is disabled')

      const raw = await readBody(req)
      if (raw === null) return send(413, 'Request too large')
      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        return send(400, 'Invalid JSON')
      }

      // remember what the agent calls itself (shown in the app)
      const info = findClientInfo(body)
      this.deps.store.touch(stored.id, { info })
      this.notifyChanged()

      const mcp = this.buildServer(stored.id)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => {
        void transport.close()
        void mcp.close()
      })
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (e) {
      if (!res.headersSent) send(500, e instanceof Error ? e.message : 'Internal error')
      else res.end()
    }
  }

  // ---------------------------------------------------------------- tools
  private client(id: string): McpClientView | undefined {
    return this.deps.store.clients().find((c) => c.id === id)
  }

  private scope(c: McpClientView): ServerInfo[] {
    const all = this.deps.listServers()
    return c.servers === 'all' ? all : all.filter((s) => (c.servers as string[]).includes(s.id))
  }

  private resolve(c: McpClientView, ref: string): { server: ServerInfo } | { error: string } {
    const scope = this.scope(c)
    const r = ref.trim().toLowerCase()
    const hits = scope.filter((s) => s.id.toLowerCase() === r || s.name.toLowerCase() === r || s.host.toLowerCase() === r)
    if (hits.length === 1) return { server: hits[0] }
    const names = scope.map((s) => s.name).join(', ') || '(none)'
    return {
      error:
        hits.length > 1
          ? `"${ref}" matches several servers; use the id. Available: ${names}`
          : `Server "${ref}" not found or not permitted for this agent. Available: ${names}`
    }
  }

  private record(entry: Omit<AuditEntry, 'ts'>): void {
    this.deps.store.audit(entry)
    this.notifyChanged()
  }

  private buildServer(clientId: string): McpServer {
    const deps = this.deps
    const view = this.client(clientId)
    const mcp = new McpServer({ name: 'server-monitor', version: deps.version }, { instructions: INSTRUCTIONS })
    if (!view) return mcp
    const base = { clientId, clientName: view.name }
    const touchCall = (): void => deps.store.touch(clientId, { call: true })
    const serverArg = z.string().describe('Server id, name or host (see list_servers)')

    if (view.caps.read) {
      mcp.registerTool(
        'list_servers',
        {
          description:
            'List the servers this agent may use, with a live health summary (state, CPU, memory, disk, uptime, Docker/PM2/service counts).',
          inputSchema: {}
        },
        async () => {
          touchCall()
          const rows = this.scope(this.client(clientId) ?? view).map((s) => summary(s, deps.getStatus(s.id)))
          this.record({ ...base, tool: 'list_servers', decision: 'ok' })
          return ok(rows)
        }
      )

      mcp.registerTool(
        'get_server_status',
        {
          description:
            'Detailed live status of one server: resources, disks, Docker containers, PM2 processes, systemd services, listening ports and availability.',
          inputSchema: { server: serverArg }
        },
        async ({ server }) => {
          touchCall()
          const r = this.resolve(this.client(clientId) ?? view, server)
          if ('error' in r) return fail(r.error)
          this.record({ ...base, tool: 'get_server_status', serverId: r.server.id, serverName: r.server.name, decision: 'ok' })
          return ok(detail(r.server, deps.getStatus(r.server.id)))
        }
      )

      mcp.registerTool(
        'list_issues',
        {
          description:
            "Problems that currently need attention across this agent's servers (offline, high CPU/memory/disk, stopped containers, errored PM2 processes, failed services).",
          inputSchema: {}
        },
        async () => {
          touchCall()
          const th = deps.thresholds()
          const issues = this.scope(this.client(clientId) ?? view).flatMap((s) =>
            detectIssues(deps.getStatus(s.id), th).map((i) => ({
              server: s.name,
              kind: i.kind,
              severity: i.severity,
              value: i.value,
              names: i.names
            }))
          )
          this.record({ ...base, tool: 'list_issues', decision: 'ok' })
          return ok(issues.length ? issues : 'No open problems.')
        }
      )

      mcp.registerTool(
        'get_policy',
        {
          description:
            'Shows what this agent is allowed to do: capabilities, server scope and the command policy (mode, deny list, allow list, limits). Read this before using run_command.',
          inputSchema: {}
        },
        async () => {
          touchCall()
          const c = this.client(clientId) ?? view
          const p = deps.store.policy
          this.record({ ...base, tool: 'get_policy', decision: 'ok' })
          return ok({
            agent: c.name,
            capabilities: c.caps,
            servers: this.scope(c).map((s) => s.name),
            commands: {
              mode: p.mode,
              meaning: MODE_TEXT[p.mode],
              denyList: p.deny,
              allowList: p.mode === 'blacklist' ? undefined : p.allow,
              timeoutSeconds: p.timeoutSec,
              maxOutputKilobytes: p.maxOutputKb
            }
          })
        }
      )
    }

    if (view.caps.logs) {
      mcp.registerTool(
        'get_logs',
        {
          description:
            'Read the latest log lines of a Docker container, a PM2 process or a systemd service (journal) on a server. Names come from get_server_status.',
          inputSchema: {
            server: serverArg,
            kind: z.enum(['docker', 'pm2', 'service']).describe('docker = container, pm2 = PM2 process, service = systemd unit'),
            name: z.string().describe('Container / process / unit name'),
            lines: z.number().int().min(10).max(2000).optional().describe('How many trailing lines (default 200)')
          }
        },
        async ({ server, kind, name, lines }) => {
          touchCall()
          const r = this.resolve(this.client(clientId) ?? view, server)
          if ('error' in r) return fail(r.error)
          const res = await deps.fetchLogs({ serverId: r.server.id, kind, name, lines: lines ?? 200 })
          this.record({
            ...base,
            tool: 'get_logs',
            serverId: r.server.id,
            serverName: r.server.name,
            command: `${kind}: ${name}`,
            decision: res.ok ? 'ok' : 'error',
            reason: res.error
          })
          return res.ok ? ok(res.text || '(no output)') : fail(res.error ?? 'Could not read the logs')
        }
      )
    }

    if (view.caps.exec) {
      mcp.registerTool(
        'run_command',
        {
          description:
            "Run a shell command on a server over SSH and return stdout, stderr and the exit code. Subject to the user's command policy: it can be refused, or wait for the user to approve it. Prefer read-only diagnostics; each call is audited.",
          inputSchema: {
            server: serverArg,
            command: z.string().min(1).max(4000).describe('The command line to run'),
            timeout_seconds: z
              .number()
              .int()
              .min(1)
              .max(600)
              .optional()
              .describe("Optional shorter timeout; cannot exceed the user's limit")
          }
        },
        async ({ server, command, timeout_seconds }) => {
          touchCall()
          const c = this.client(clientId) ?? view
          if (!c.caps.exec) return fail('This agent is not allowed to run commands.')
          const r = this.resolve(c, server)
          if ('error' in r) return fail(r.error)
          const entry = { ...base, tool: 'run_command', serverId: r.server.id, serverName: r.server.name, command }
          const policy = deps.store.policy

          const v = evaluateCommand(command, policy)
          if (v.decision === 'deny') {
            this.record({ ...entry, decision: 'denied', reason: verdictReason(v) })
            return fail(`Command refused: ${verdictReason(v)}`)
          }
          let decision: AuditEntry['decision'] = 'allowed'
          if (v.decision === 'ask') {
            const yes = await deps.approve({ clientName: c.name, serverName: r.server.name, command })
            if (!yes) {
              this.record({ ...entry, decision: 'rejected', reason: 'Not approved by the user' })
              return fail('The user did not approve this command (rejected or no answer in time).')
            }
            decision = 'approved'
          }

          const running = this.inflight.get(clientId) ?? 0
          if (running >= MAX_PARALLEL_EXEC)
            return fail(`Too many commands running at once (limit ${MAX_PARALLEL_EXEC}). Wait for one to finish.`)
          this.inflight.set(clientId, running + 1)
          try {
            const timeout = Math.min(timeout_seconds ?? policy.timeoutSec, policy.timeoutSec)
            const out = await deps.exec(r.server.id, command, timeout * 1000, policy.maxOutputKb * 1024)
            this.record({
              ...entry,
              decision,
              exitCode: out.code,
              ms: out.ms,
              reason: out.timedOut ? 'Timed out' : out.truncated ? 'Output truncated' : undefined
            })
            const payload = {
              exitCode: out.code,
              timedOut: out.timedOut,
              truncated: out.truncated,
              durationMs: out.ms,
              stdout: out.stdout,
              stderr: out.stderr
            }
            return out.timedOut ? { ...ok(payload), isError: true } : ok(payload)
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            this.record({ ...entry, decision: 'error', reason: message })
            return fail(message)
          } finally {
            this.inflight.set(clientId, Math.max(0, (this.inflight.get(clientId) ?? 1) - 1))
          }
        }
      )
    }
    return mcp
  }
}

const MODE_TEXT = {
  off: 'Command execution is disabled.',
  ask: "Every command needs the user's approval, except commands that match the allow list (they run immediately).",
  whitelist: 'Only commands that match the allow list may run; anything else is refused.',
  blacklist: 'Any command may run unless it matches the deny list.'
} as const

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const b = chunk as Buffer
    size += b.length
    if (size > MAX_BODY) return null
    chunks.push(b)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** `initialize` carries params.clientInfo = { name, version }. */
function findClientInfo(body: unknown): { name: string; version: string } | undefined {
  for (const msg of Array.isArray(body) ? body : [body]) {
    const m = msg as { method?: unknown; params?: { clientInfo?: { name?: unknown; version?: unknown } } } | null
    if (m?.method === 'initialize' && typeof m.params?.clientInfo?.name === 'string') {
      return { name: m.params.clientInfo.name, version: String(m.params.clientInfo.version ?? '') }
    }
  }
  return undefined
}

// ---------------------------------------------------------------- shaping data for agents
const pct = (n: number): number => Math.round(n * 10) / 10

function summary(s: ServerInfo, st: ServerStatus | undefined): Record<string, unknown> {
  const base = { id: s.id, name: s.name, host: s.host }
  if (!st || st.state !== 'online') return { ...base, state: st?.state ?? 'connecting', error: st?.error }
  const worst = st.disks.reduce<{ mount: string; pct: number } | null>(
    (a, d) => (!a || d.pct > a.pct ? { mount: d.mount, pct: d.pct } : a),
    null
  )
  return {
    ...base,
    state: st.state,
    os: st.os,
    uptimeSeconds: Math.round(st.uptimeSec),
    cpuPercent: pct(st.cpu),
    memoryPercent: pct(st.memPct),
    worstDisk: worst ? { mount: worst.mount, percent: pct(worst.pct) } : undefined,
    docker: st.docker.available ? { running: st.docker.running, total: st.docker.total } : undefined,
    pm2: st.pm2.available && st.pm2.daemon ? { online: st.pm2.online, total: st.pm2.total } : undefined,
    failedServices: st.services.failed
  }
}

function detail(s: ServerInfo, st: ServerStatus | undefined): Record<string, unknown> {
  if (!st || st.state !== 'online') return { id: s.id, name: s.name, host: s.host, state: st?.state ?? 'connecting', error: st?.error }
  return {
    id: s.id,
    name: s.name,
    host: s.host,
    state: st.state,
    os: st.os,
    kernel: st.kernel,
    hostname: st.hostname,
    uptimeSeconds: Math.round(st.uptimeSec),
    latencyMs: st.latencyMs,
    cpu: { percent: pct(st.cpu), cores: st.cores, load: st.load },
    memory: {
      percent: pct(st.memPct),
      usedBytes: st.memUsed,
      totalBytes: st.memTotal,
      swapUsedBytes: st.swapUsed,
      swapTotalBytes: st.swapTotal
    },
    network: { rxBytesPerSecond: Math.round(st.netRx), txBytesPerSecond: Math.round(st.netTx) },
    disks: st.disks.map((d) => ({ mount: d.mount, fs: d.fs, percent: pct(d.pct), usedBytes: d.used, sizeBytes: d.size })),
    docker: st.docker.available ? st.docker.containers : null,
    pm2:
      st.pm2.available && st.pm2.daemon
        ? st.pm2.procs.map((p) => ({ name: p.name, status: p.status, cpuPercent: p.cpu, memoryBytes: p.memory, restarts: p.restarts }))
        : null,
    services: st.services.available ? { running: st.services.running, failed: st.services.failed } : null,
    ports: st.ports,
    availability: st.availability
  }
}
