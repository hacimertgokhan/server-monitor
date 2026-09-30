import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_POLICY } from '@shared/mcp'
import { McpError, McpStore } from './mcp-store'

let dir: string
let clock = 1_000_000
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm-mcp-'))
  clock = 1_000_000
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const open = (): McpStore => new McpStore(dir, () => clock++)
const caps = { read: true, logs: true, exec: false }

describe('defaults', () => {
  it('starts switched off, on the default port, with the "ask" policy and no agents', () => {
    const s = open()
    expect(s.enabled).toBe(false)
    expect(s.port).toBe(8765)
    expect(s.policy.mode).toBe('ask')
    expect(s.clients()).toEqual([])
  })
})

describe('agents and tokens', () => {
  it('creates an agent, returns the token once and stores only its hash', () => {
    const s = open()
    const { client, token } = s.createClient({ name: 'Claude Code', servers: 'all', caps })
    expect(token).toMatch(/^smcp_[A-Za-z0-9_-]{40,}$/)
    expect(client.tokenPrefix).toBe(token.slice(0, 9))
    expect(JSON.stringify(client)).not.toContain(token)
    const file = readFileSync(join(dir, 'mcp.json'), 'utf8')
    expect(file).not.toContain(token) // never on disk in clear
    expect(file).toContain('tokenHash')
  })

  it('authenticates by token, rejects wrong ones and survives a restart', () => {
    const s = open()
    const { token } = s.createClient({ name: 'a', servers: 'all', caps })
    expect(s.authenticate(token)?.name).toBe('a')
    expect(s.authenticate(token + 'x')).toBeNull()
    expect(s.authenticate('smcp_nope')).toBeNull()
    expect(s.authenticate('')).toBeNull()
    expect(open().authenticate(token)?.name).toBe('a')
  })

  it('never exposes the hash to the UI', () => {
    const s = open()
    s.createClient({ name: 'a', servers: 'all', caps })
    expect(JSON.stringify(s.view())).not.toContain('tokenHash')
    expect(Object.keys(s.clients()[0])).not.toContain('tokenHash')
  })

  it('rotating a token invalidates the old one', () => {
    const s = open()
    const { client, token } = s.createClient({ name: 'a', servers: 'all', caps })
    const rotated = s.rotateToken(client.id)
    expect(s.authenticate(token)).toBeNull()
    expect(s.authenticate(rotated.token)?.id).toBe(client.id)
  })

  it('enforces unique, non-empty names and a sane agent count', () => {
    const s = open()
    s.createClient({ name: 'Cursor', servers: 'all', caps })
    expect(() => s.createClient({ name: 'cursor', servers: 'all', caps })).toThrow(McpError)
    expect(() => s.createClient({ name: '   ', servers: 'all', caps })).toThrow('name is required')
    for (let i = 0; i < 49; i++) s.createClient({ name: `agent-${i}`, servers: 'all', caps })
    expect(() => s.createClient({ name: 'one too many', servers: 'all', caps })).toThrow('Too many')
  })

  it('updates, disables and deletes agents', () => {
    const s = open()
    const { client, token } = s.createClient({ name: 'a', servers: ['s1'], caps })
    const u = s.updateClient(client.id, {
      name: 'b',
      enabled: false,
      servers: ['s1', 's2', 's2'],
      caps: { read: true, logs: false, exec: true }
    })
    expect(u).toMatchObject({ name: 'b', enabled: false, servers: ['s1', 's2'], caps: { read: true, logs: false, exec: true } })
    expect(s.authenticate(token)?.enabled).toBe(false)
    s.deleteClient(client.id)
    expect(s.authenticate(token)).toBeNull()
    expect(() => s.deleteClient(client.id)).toThrow('Unknown agent')
  })

  it('defaults exec to off and forgets servers that were removed', () => {
    const s = open()
    const { client } = s.createClient({
      name: 'a',
      servers: ['s1', 's2'],
      caps: { read: true, logs: true, exec: undefined as unknown as boolean }
    })
    expect(client.caps.exec).toBe(false)
    s.pruneServers(['s2'])
    expect(s.clients()[0].servers).toEqual(['s2'])
    s.updateClient(client.id, { servers: 'all' })
    s.pruneServers([])
    expect(s.clients()[0].servers).toBe('all')
  })

  it('tracks last seen, call counts and client info', () => {
    const s = open()
    const { client } = s.createClient({ name: 'a', servers: 'all', caps })
    s.touch(client.id, { call: true, info: { name: 'claude-code', version: '2.1.0' } })
    s.touch(client.id, { call: true })
    s.flush()
    const c = open().clients()[0]
    expect(c.calls).toBe(2)
    expect(c.clientInfo).toEqual({ name: 'claude-code', version: '2.1.0' })
    expect(c.lastSeen).toBeGreaterThan(1_000_000)
  })
})

describe('settings', () => {
  it('validates the port and persists the switch', () => {
    const s = open()
    expect(() => s.setPort(80)).toThrow('between 1024')
    expect(() => s.setPort('8765')).toThrow(McpError)
    s.setPort(9100)
    s.setEnabled(true)
    const again = open()
    expect([again.enabled, again.port]).toEqual([true, 9100])
  })

  it('sanitises policies coming from the UI', () => {
    const s = open()
    const p = s.setPolicy({ mode: 'whitelist', deny: ['reboot', '/(broken/'], allow: ['uptime'], timeoutSec: 5000 })
    expect(p).toMatchObject({ mode: 'whitelist', deny: ['reboot'], allow: ['uptime'], timeoutSec: 600 })
    expect(open().policy.mode).toBe('whitelist')
  })

  it('falls back to safe defaults when the file is corrupt', () => {
    writeFileSync(join(dir, 'mcp.json'), '{ not json')
    const s = open()
    expect(s.enabled).toBe(false)
    expect(s.policy).toEqual(DEFAULT_POLICY)
  })
})

describe('audit log', () => {
  it('appends, returns newest first, and clears', () => {
    const s = open()
    for (let i = 0; i < 5; i++) s.audit({ clientId: 'c', clientName: 'a', tool: 'run_command', command: `cmd ${i}`, decision: 'allowed' })
    const log = s.readAudit(3)
    expect(log.map((e) => e.command)).toEqual(['cmd 4', 'cmd 3', 'cmd 2'])
    expect(log[0].ts).toBeGreaterThan(0)
    s.clearAudit()
    expect(s.readAudit()).toEqual([])
  })

  it('skips torn lines instead of failing', () => {
    const s = open()
    s.audit({ clientId: 'c', clientName: 'a', tool: 'list_servers', decision: 'ok' })
    writeFileSync(join(dir, 'mcp-audit.jsonl'), readFileSync(join(dir, 'mcp-audit.jsonl'), 'utf8') + '{"ts": 1, "tool": \n')
    expect(s.readAudit()).toHaveLength(1)
  })
})
