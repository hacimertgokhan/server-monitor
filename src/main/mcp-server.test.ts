import http from 'http'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { DEFAULT_ALLOW, DEFAULT_DENY } from '@shared/mcp'
import type { Capabilities, ExecMode } from '@shared/mcp'
import type { ServerInfo, ServerStatus } from '@shared/types'
import { McpService } from './mcp-server'
import type { McpDeps } from './mcp-server'
import { McpStore } from './mcp-store'
import type { ExecResult } from './monitor'

const servers: ServerInfo[] = [
  { id: 's-web', name: 'web-prod-01', host: '203.0.113.10', port: 22, username: 'deploy', authType: 'key' },
  { id: 's-db', name: 'db-master', host: '203.0.113.21', port: 22, username: 'root', authType: 'key' }
]

const status = (id: string, over: Partial<ServerStatus> = {}): ServerStatus =>
  ({
    id,
    state: 'online',
    checkedAt: 0,
    latencyMs: 12,
    cpu: 12.34,
    cores: 4,
    load: [0.1, 0.2, 0.3],
    memTotal: 8e9,
    memUsed: 2e9,
    memPct: 25,
    swapTotal: 0,
    swapUsed: 0,
    netRx: 0,
    netTx: 0,
    uptimeSec: 3600,
    os: 'Ubuntu 22.04',
    kernel: '6.5',
    hostname: id,
    disks: [{ mount: '/', fs: 'ext4', size: 100, used: 40, pct: 40 }],
    docker: {
      available: true,
      running: 1,
      total: 2,
      containers: [
        { name: 'web', image: 'nginx', state: 'running', status: 'Up' },
        { name: 'db', image: 'pg', state: 'exited', status: 'Exited' }
      ]
    },
    pm2: { available: false, daemon: false, online: 0, total: 0, procs: [] },
    services: { available: true, running: ['ssh'], failed: [] },
    ports: [],
    cpuHistory: [],
    memHistory: [],
    availability: { pct24h: 100, pct7d: 100, pct30d: 100, incidents24h: 0, trackedSince: 0 },
    ...over
  }) as ServerStatus

let dir: string
let store: McpStore
let svc: McpService
let deps: McpDeps
let exec: Mock<McpDeps['exec']>
let approve: Mock<McpDeps['approve']>
let clients: Client[] = []

const result = (): ExecResult => ({ stdout: 'ok\n', stderr: '', code: 0, signal: null, truncated: false, timedOut: false, ms: 5 })

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sm-mcp-srv-'))
  store = new McpStore(dir)
  exec = vi.fn<McpDeps['exec']>(async () => result())
  approve = vi.fn<McpDeps['approve']>(async () => true)
  deps = {
    store,
    version: '9.9.9',
    listServers: () => servers,
    getStatus: (id) => status(id),
    thresholds: () => ({ cpu: 90, ram: 90, disk: 90 }),
    fetchLogs: vi.fn(async (r) => ({ ok: true, text: `logs of ${r.name}`, at: 1 })),
    exec,
    approve,
    changed: () => undefined
  }
  svc = new McpService(deps)
  await svc.start(0) // any free port
})

afterEach(async () => {
  for (const c of clients) await c.close().catch(() => undefined)
  clients = []
  await svc.stop()
  rmSync(dir, { recursive: true, force: true })
})

const agent = (name: string, caps: Partial<Capabilities>, scope: 'all' | string[] = 'all'): { token: string; id: string } => {
  const { client, token } = store.createClient({ name, servers: scope, caps: { read: true, logs: true, exec: false, ...caps } })
  return { token, id: client.id }
}

async function connect(token: string, clientName = 'vitest-client'): Promise<Client> {
  const c = new Client({ name: clientName, version: '1.2.3' })
  await c.connect(new StreamableHTTPClientTransport(new URL(svc.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  clients.push(c)
  return c
}

const text = (r: unknown): string => (r as { content: { text: string }[] }).content[0]?.text ?? ''
const isError = (r: unknown): boolean => (r as { isError?: boolean }).isError === true
const call = (c: Client, name: string, args: Record<string, unknown> = {}) => c.callTool({ name, arguments: args })

/** Raw HTTP with full control over headers (Host, Origin ...). */
function raw(opts: {
  method?: string
  path?: string
  headers?: Record<string, string>
  body?: string
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: svc.port, method: opts.method ?? 'POST', path: opts.path ?? '/mcp', headers: opts.headers },
      (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
      }
    )
    req.on('error', reject)
    req.end(opts.body)
  })
}

const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } }
})
const json = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

describe('transport security', () => {
  it('listens on the loopback interface only', () => {
    expect(svc.listening).toBe(true)
    expect(svc.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })

  it('refuses requests without a valid agent token', async () => {
    const none = await raw({ headers: { ...json, host: `127.0.0.1:${svc.port}` }, body: initBody })
    expect(none.status).toBe(401)
    expect(none.headers['www-authenticate']).toContain('Bearer')
    const wrong = await raw({ headers: { ...json, host: `127.0.0.1:${svc.port}`, authorization: 'Bearer smcp_nope' }, body: initBody })
    expect(wrong.status).toBe(401)
    const basic = await raw({ headers: { ...json, host: `127.0.0.1:${svc.port}`, authorization: 'Basic abc' }, body: initBody })
    expect(basic.status).toBe(401)
  })

  it('refuses browser requests (Origin) and DNS-rebinding hosts, even with a valid token', async () => {
    const { token } = agent('a', {})
    const auth = { ...json, authorization: `Bearer ${token}` }
    expect(
      (await raw({ headers: { ...auth, host: `127.0.0.1:${svc.port}`, origin: 'https://evil.example' }, body: initBody })).status
    ).toBe(403)
    expect((await raw({ headers: { ...auth, host: 'evil.example' }, body: initBody })).status).toBe(403)
    expect((await raw({ headers: { ...auth, host: `evil.example:${svc.port}` }, body: initBody })).status).toBe(403)
    expect((await raw({ headers: { ...auth, host: `localhost:${svc.port}` }, body: initBody })).status).toBe(200)
  })

  it('only serves POST /mcp and rejects junk bodies', async () => {
    const { token } = agent('a', {})
    const h = { ...json, host: `127.0.0.1:${svc.port}`, authorization: `Bearer ${token}` }
    expect((await raw({ method: 'GET', headers: h })).status).toBe(405)
    expect((await raw({ method: 'DELETE', headers: h })).status).toBe(405)
    expect((await raw({ path: '/other', headers: h, body: initBody })).status).toBe(404)
    expect((await raw({ headers: h, body: '{ not json' })).status).toBe(400)
    expect((await raw({ headers: h, body: 'x'.repeat(1024 * 1024 + 10) })).status).toBe(413)
  })

  it('refuses a disabled agent and honours deletion immediately', async () => {
    const a = agent('a', {})
    const h = { ...json, host: `127.0.0.1:${svc.port}`, authorization: `Bearer ${a.token}` }
    expect((await raw({ headers: h, body: initBody })).status).toBe(200)
    store.updateClient(a.id, { enabled: false })
    expect((await raw({ headers: h, body: initBody })).status).toBe(403)
    store.deleteClient(a.id)
    expect((await raw({ headers: h, body: initBody })).status).toBe(401)
  })

  it('does not leave the port open after stop()', async () => {
    const port = svc.port
    await svc.stop()
    expect(svc.listening).toBe(false)
    await expect(raw({ headers: { ...json, host: `127.0.0.1:${port}` }, body: initBody })).rejects.toBeTruthy()
  })

  it('reports a busy port instead of throwing', async () => {
    const other = new McpService(deps)
    await other.start(svc.port)
    expect(other.listening).toBe(false)
    expect(other.error).toMatch(/already in use/)
  })
})

describe('capabilities decide which tools exist', () => {
  it('a read-only agent sees no run_command and cannot call it', async () => {
    const { token } = agent('ro', { exec: false })
    const c = await connect(token)
    const names = (await c.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['get_logs', 'get_policy', 'get_server_status', 'list_issues', 'list_servers'])
    const r = await call(c, 'run_command', { server: 's-web', command: 'uptime' })
    expect(isError(r)).toBe(true)
    expect(text(r)).toMatch(/not found/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('an exec agent gets run_command; without read/logs those tools disappear', async () => {
    const { token } = agent('ex', { exec: true, read: false, logs: false })
    const names = (await (await connect(token)).listTools()).tools.map((t) => t.name)
    expect(names).toEqual(['run_command'])
  })

  it('records what the agent calls itself and counts calls', async () => {
    const { token, id } = agent('a', {})
    const c = await connect(token, 'claude-code')
    await call(c, 'list_servers')
    await call(c, 'list_servers')
    store.flush()
    const v = store.clients().find((x) => x.id === id)!
    expect(v.clientInfo).toEqual({ name: 'claude-code', version: '1.2.3' })
    expect(v.calls).toBe(2)
    expect(v.lastSeen).toBeGreaterThan(0)
  })
})

describe('read tools', () => {
  it('lists servers with a health summary', async () => {
    const c = await connect(agent('a', {}).token)
    const rows = JSON.parse(text(await call(c, 'list_servers')))
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['web-prod-01', 'db-master'])
    expect(rows[0]).toMatchObject({ state: 'online', cpuPercent: 12.3, docker: { running: 1, total: 2 } })
  })

  it('restricts an agent to its servers, by id, name or host', async () => {
    const c = await connect(agent('scoped', {}, ['s-web']).token)
    expect(JSON.parse(text(await call(c, 'list_servers')))).toHaveLength(1)
    const ok = await call(c, 'get_server_status', { server: 'WEB-PROD-01' })
    expect(JSON.parse(text(ok)).docker).toHaveLength(2)
    const other = await call(c, 'get_server_status', { server: 'db-master' })
    expect(isError(other)).toBe(true)
    expect(text(other)).toMatch(/not found or not permitted/)
    expect(text(other)).toContain('web-prod-01') // tells the agent what it may use
    expect(text(other)).not.toContain('db-master.') // and does not reveal others
  })

  it('reports problems and serves logs through the shared log reader', async () => {
    const c = await connect(agent('a', {}).token)
    expect(text(await call(c, 'list_issues'))).toContain('docker')
    const logs = await call(c, 'get_logs', { server: 's-web', kind: 'docker', name: 'web', lines: 50 })
    expect(text(logs)).toBe('logs of web')
    expect(deps.fetchLogs).toHaveBeenCalledWith({ serverId: 's-web', kind: 'docker', name: 'web', lines: 50 })
    const bad = await call(c, 'get_logs', { server: 's-web', kind: 'shell', name: 'x' }) // schema rejects unknown kinds
    expect(isError(bad)).toBe(true)
    expect(text(bad)).toMatch(/Invalid arguments/)
    expect(deps.fetchLogs).toHaveBeenCalledTimes(1)
  })

  it('tells the agent what it may do', async () => {
    const c = await connect(agent('a', { exec: false }).token)
    const p = JSON.parse(text(await call(c, 'get_policy')))
    expect(p.capabilities).toEqual({ read: true, logs: true, exec: false })
    expect(p.commands.mode).toBe('ask')
    expect(p.commands.denyList).toEqual(DEFAULT_DENY)
  })
})

const setMode = (mode: ExecMode, over: Record<string, unknown> = {}): void =>
  void store.setPolicy({ mode, deny: DEFAULT_DENY, allow: DEFAULT_ALLOW, ...over })

describe('run_command', () => {
  it('ask mode: allow-listed commands run at once, others wait for the user', async () => {
    const c = await connect(agent('ex', { exec: true }).token)
    setMode('ask')

    const safe = await call(c, 'run_command', { server: 's-web', command: 'uptime' })
    expect(JSON.parse(text(safe))).toMatchObject({ exitCode: 0, stdout: 'ok\n' })
    expect(approve).not.toHaveBeenCalled()

    const risky = await call(c, 'run_command', { server: 's-web', command: 'docker restart web' })
    expect(approve).toHaveBeenCalledWith({ clientName: 'ex', serverName: 'web-prod-01', command: 'docker restart web' })
    expect(isError(risky)).toBe(false)
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('ask mode: a rejected (or unanswered) command never reaches the server', async () => {
    const c = await connect(agent('ex', { exec: true }).token)
    setMode('ask')
    approve.mockResolvedValueOnce(false)
    const r = await call(c, 'run_command', { server: 's-web', command: 'docker restart web' })
    expect(isError(r)).toBe(true)
    expect(text(r)).toMatch(/did not approve/)
    expect(exec).not.toHaveBeenCalled()
    expect(store.readAudit()[0]).toMatchObject({ tool: 'run_command', decision: 'rejected', command: 'docker restart web' })
  })

  it('whitelist mode: refuses everything not on the list, without asking', async () => {
    const c = await connect(agent('ex', { exec: true }).token)
    setMode('whitelist')
    expect(isError(await call(c, 'run_command', { server: 's-web', command: 'df -h' }))).toBe(false)
    const no = await call(c, 'run_command', { server: 's-web', command: 'systemctl restart nginx' })
    expect(isError(no)).toBe(true)
    expect(text(no)).toMatch(/Not on the allow list/)
    expect(text(await call(c, 'run_command', { server: 's-web', command: 'uptime && cat /etc/shadow' }))).toMatch(
      /Not on the allow list: cat/
    )
    expect(text(await call(c, 'run_command', { server: 's-web', command: 'uptime $(id)' }))).toMatch(/cannot verify/)
    expect(approve).not.toHaveBeenCalled()
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('blacklist mode: allows the rest, blocks the deny list and always the built-in limits', async () => {
    const c = await connect(agent('ex', { exec: true }).token)
    setMode('blacklist')
    expect(isError(await call(c, 'run_command', { server: 's-web', command: 'systemctl restart nginx' }))).toBe(false)
    expect(text(await call(c, 'run_command', { server: 's-web', command: 'reboot' }))).toMatch(/deny list: reboot/)
    setMode('blacklist', { deny: [], allow: [] })
    expect(text(await call(c, 'run_command', { server: 's-web', command: 'rm -rf /' }))).toMatch(/built-in safety rule/)
    expect(text(await call(c, 'run_command', { server: 's-web', command: 'echo $(rm -rf /*)' }))).toMatch(/built-in safety rule/)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('off mode refuses everything, and policy changes apply to the very next call', async () => {
    const c = await connect(agent('ex', { exec: true }).token)
    setMode('off')
    expect(text(await call(c, 'run_command', { server: 's-web', command: 'uptime' }))).toMatch(/disabled/)
    setMode('blacklist')
    expect(isError(await call(c, 'run_command', { server: 's-web', command: 'uptime' }))).toBe(false)
  })

  it('cannot run on servers outside the agent scope', async () => {
    const c = await connect(agent('ex', { exec: true }, ['s-web']).token)
    setMode('blacklist')
    const r = await call(c, 'run_command', { server: 's-db', command: 'uptime' })
    expect(isError(r)).toBe(true)
    expect(exec).not.toHaveBeenCalled()
  })

  it('clamps the timeout to the policy and the output to the policy limit', async () => {
    const c = await connect(agent('ex', { exec: true }).token)
    setMode('blacklist', { timeoutSec: 30, maxOutputKb: 10 })
    await call(c, 'run_command', { server: 's-web', command: 'uptime', timeout_seconds: 600 })
    await call(c, 'run_command', { server: 's-web', command: 'uptime', timeout_seconds: 5 })
    expect(exec.mock.calls[0]).toEqual(['s-web', 'uptime', 30_000, 10 * 1024])
    expect(exec.mock.calls[1][2]).toBe(5_000)
  })

  it('surfaces timeouts and failures as errors', async () => {
    const c = await connect(agent('ex', { exec: true }).token)
    setMode('blacklist')
    exec.mockResolvedValueOnce({ ...result(), code: null, timedOut: true })
    const t = await call(c, 'run_command', { server: 's-web', command: 'sleep 999' })
    expect(isError(t)).toBe(true)
    expect(JSON.parse(text(t)).timedOut).toBe(true)
    exec.mockRejectedValueOnce(new Error('Server is offline'))
    const f = await call(c, 'run_command', { server: 's-web', command: 'uptime' })
    expect(isError(f)).toBe(true)
    expect(text(f)).toBe('Server is offline')
  })

  it('records every decision in the audit log', async () => {
    const c = await connect(agent('ex', { exec: true }).token)
    setMode('ask')
    await call(c, 'run_command', { server: 's-web', command: 'uptime' })
    await call(c, 'run_command', { server: 's-web', command: 'docker restart web' })
    await call(c, 'run_command', { server: 's-web', command: 'reboot' })
    approve.mockResolvedValueOnce(false)
    await call(c, 'run_command', { server: 's-web', command: 'apt upgrade -y' })
    const decisions = store
      .readAudit()
      .reverse()
      .map((e) => [e.command, e.decision])
    expect(decisions).toEqual([
      ['uptime', 'allowed'],
      ['docker restart web', 'approved'],
      ['reboot', 'denied'],
      ['apt upgrade -y', 'rejected']
    ])
    expect(store.readAudit()[3]).toMatchObject({ clientName: 'ex', serverName: 'web-prod-01', exitCode: 0 })
  })

  it('limits parallel commands per agent', async () => {
    const c = await connect(agent('ex', { exec: true }).token)
    setMode('blacklist')
    const releases: (() => void)[] = []
    exec.mockImplementation(() => new Promise<ExecResult>((res) => releases.push(() => res(result()))))
    const pending = Array.from({ length: 4 }, (_, i) => call(c, 'run_command', { server: 's-web', command: `sleep ${i + 1}` }))
    await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(4))
    const fifth = await call(c, 'run_command', { server: 's-web', command: 'sleep 9' })
    expect(isError(fifth)).toBe(true)
    expect(text(fifth)).toMatch(/Too many commands/)
    releases.forEach((r) => r())
    exec.mockImplementation(async () => result())
    await Promise.allSettled(pending)
  })
})
