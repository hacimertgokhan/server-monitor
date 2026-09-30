import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_POLICY, sanitizeCaps, sanitizePolicy } from '@shared/mcp'
import type { AuditEntry, McpClientView, McpState } from '@shared/mcp'
import type { Api, McpApi, McpResult } from '@shared/types'

export const SERVER_NAME = 'server-monitor'

/** One-liner for Claude Code. */
export const claudeCodeCommand = (url: string, token: string): string =>
  `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: Bearer ${token}"`

/** Config for clients that read a JSON file (Cursor, Windsurf, Claude Desktop through a bridge, ...). */
export const jsonConfig = (url: string, token: string): string =>
  JSON.stringify({ mcpServers: { [SERVER_NAME]: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)

/** "12 s ago" style label without pulling in a date library. */
export function relativeTime(ts: number | undefined, now: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!ts) return t('never')
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return t('just now')
  if (s < 60) return t('{n} s ago', { n: s })
  if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) })
  if (s < 86400) return t('{n} h ago', { n: Math.round(s / 3600) })
  return t('{n} d ago', { n: Math.round(s / 86400) })
}

/** An agent counts as connected when it talked to us in the last minute. */
export const isActive = (c: McpClientView, now: number): boolean => !!c.lastSeen && now - c.lastSeen < 60_000

// ---------------------------------------------------------------- in-memory demo (browser preview, no Electron)
function createDemoMcp(): McpApi {
  const now = Date.now()
  let state: McpState = {
    enabled: true,
    port: 8765,
    listening: true,
    url: 'http://127.0.0.1:8765/mcp',
    policy: sanitizePolicy(DEFAULT_POLICY),
    clients: [
      {
        id: 'demo-a',
        name: 'Claude Code',
        tokenPrefix: 'smcp_Kx3f',
        createdAt: now - 3 * 86400_000,
        enabled: true,
        servers: 'all',
        caps: { read: true, logs: true, exec: true },
        lastSeen: now - 12_000,
        calls: 128,
        clientInfo: { name: 'claude-code', version: '2.1.4' }
      },
      {
        id: 'demo-b',
        name: 'Cursor (read-only)',
        tokenPrefix: 'smcp_Qp9a',
        createdAt: now - 9 * 86400_000,
        enabled: true,
        servers: ['demo-web', 'demo-api'],
        caps: { read: true, logs: true, exec: false },
        lastSeen: now - 5 * 3600_000,
        calls: 17,
        clientInfo: { name: 'cursor', version: '0.48' }
      }
    ]
  }
  let audit: AuditEntry[] = [
    {
      ts: now - 12_000,
      clientId: 'demo-a',
      clientName: 'Claude Code',
      tool: 'run_command',
      serverName: 'web-prod-01',
      command: 'docker ps -a',
      decision: 'allowed',
      exitCode: 0,
      ms: 212
    },
    {
      ts: now - 55_000,
      clientId: 'demo-a',
      clientName: 'Claude Code',
      tool: 'run_command',
      serverName: 'api-eu',
      command: 'docker restart api',
      decision: 'approved',
      exitCode: 0,
      ms: 1840
    },
    {
      ts: now - 90_000,
      clientId: 'demo-a',
      clientName: 'Claude Code',
      tool: 'run_command',
      serverName: 'db-master',
      command: 'reboot',
      decision: 'denied',
      reason: 'Blocked by the deny list: reboot'
    },
    {
      ts: now - 4 * 60_000,
      clientId: 'demo-a',
      clientName: 'Claude Code',
      tool: 'get_logs',
      serverName: 'web-prod-01',
      command: 'docker: nginx',
      decision: 'ok'
    },
    {
      ts: now - 9 * 60_000,
      clientId: 'demo-a',
      clientName: 'Claude Code',
      tool: 'run_command',
      serverName: 'worker-01',
      command: 'apt upgrade -y',
      decision: 'rejected',
      reason: 'Not approved by the user'
    },
    { ts: now - 5 * 3600_000, clientId: 'demo-b', clientName: 'Cursor (read-only)', tool: 'list_servers', decision: 'ok' }
  ]
  const listeners = new Set<(s: McpState) => void>()
  const emit = (): void => listeners.forEach((l) => l(state))
  const done = (token?: string): McpResult => {
    emit()
    return { ok: true, state, token }
  }
  const find = (id: string): McpClientView | undefined => state.clients.find((c) => c.id === id)
  return {
    getState: async () => state,
    setEnabled: async (on) => {
      state = { ...state, enabled: on, listening: on }
      return done()
    },
    setPort: async (port) => {
      if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, error: 'Port must be between 1024 and 65535' }
      state = { ...state, port, url: `http://127.0.0.1:${port}/mcp` }
      return done()
    },
    createAgent: async (input) => {
      if (!input.name.trim()) return { ok: false, error: 'Agent name is required' }
      if (state.clients.some((c) => c.name.toLowerCase() === input.name.trim().toLowerCase()))
        return { ok: false, error: 'An agent with this name already exists' }
      const token = `smcp_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
      state = {
        ...state,
        clients: [
          ...state.clients,
          {
            id: `demo-${Date.now()}`,
            name: input.name.trim(),
            tokenPrefix: token.slice(0, 9),
            createdAt: Date.now(),
            enabled: true,
            servers: input.servers,
            caps: sanitizeCaps(input.caps),
            calls: 0
          }
        ]
      }
      return done(token)
    },
    updateAgent: async (id, patch) => {
      const c = find(id)
      if (!c) return { ok: false, error: 'Unknown agent' }
      Object.assign(c, patch, patch.caps ? { caps: sanitizeCaps(patch.caps) } : {})
      state = { ...state, clients: [...state.clients] }
      return done()
    },
    rotateToken: async (id) => {
      const c = find(id)
      if (!c) return { ok: false, error: 'Unknown agent' }
      const token = `smcp_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
      c.tokenPrefix = token.slice(0, 9)
      state = { ...state, clients: [...state.clients] }
      return done(token)
    },
    deleteAgent: async (id) => {
      state = { ...state, clients: state.clients.filter((c) => c.id !== id) }
      return done()
    },
    setPolicy: async (policy) => {
      state = { ...state, policy: sanitizePolicy(policy) }
      return done()
    },
    getAudit: async (limit = 200) => audit.slice(0, limit),
    clearAudit: async () => {
      audit = []
    },
    onChange: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}

let demo: McpApi | undefined

/** MCP state + actions. Uses the real IPC bridge in the app and an in-memory demo in the browser preview. */
export function useMcp(api: Api | undefined): { mcp: McpApi; state: McpState | null } {
  const mcp = useMemo(() => api?.mcp ?? (demo ??= createDemoMcp()), [api])
  const [state, setState] = useState<McpState | null>(null)
  useEffect(() => {
    let alive = true
    void mcp.getState().then((s) => alive && setState(s))
    const off = mcp.onChange((s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [mcp])
  return { mcp, state }
}
