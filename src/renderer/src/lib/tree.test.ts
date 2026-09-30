import { describe, expect, it } from 'vitest'
import type { ServerStatus } from '@shared/types'
import { DEMO_SERVERS, demoStatus } from './demo'
import { FEW, buildGroup } from './tree'

const online = (over: Partial<ServerStatus> = {}): ServerStatus => ({ ...demoStatus('demo-web'), state: 'online', ...over })

describe('buildGroup', () => {
  it('returns nothing for offline or unknown servers', () => {
    expect(buildGroup('docker', undefined, 'few')).toBeNull()
    expect(buildGroup('docker', { ...online(), state: 'offline' }, 'few')).toBeNull()
  })

  it('lists docker containers with problems first', () => {
    const s = online({
      docker: {
        available: true,
        running: 1,
        total: 3,
        containers: [
          { name: 'web', image: 'nginx', state: 'running', status: 'Up 3 days' },
          { name: 'db', image: 'postgres', state: 'exited', status: 'Exited (1)' },
          { name: 'x', image: 'redis', state: 'restarting', status: 'Restarting' }
        ]
      }
    })
    const g = buildGroup('docker', s, 'few')!
    expect(g.summary).toBe('1/3')
    expect(g.tone).toBe('warn')
    expect(g.leaves.map((l) => [l.label, l.tone])).toEqual([
      ['db', 'bad'],
      ['x', 'warn'],
      ['web', 'ok']
    ])
  })

  it('skips groups the server has no data for', () => {
    const s = online({
      docker: { available: false, running: 0, total: 0, containers: [] },
      pm2: { available: true, daemon: false, online: 0, total: 0, procs: [] }
    })
    expect(buildGroup('docker', s, 'few')).toBeNull()
    expect(buildGroup('pm2', s, 'few')).toBeNull()
  })

  it('shows failed services first, then well-known daemons', () => {
    const s = online({ services: { available: true, running: ['zzz', 'cron', 'nginx', 'aaa'], failed: ['fail2ban'] } })
    const g = buildGroup('services', s, 'all')!
    expect(g.tone).toBe('bad')
    expect(g.leaves.map((l) => l.label)).toEqual(['fail2ban', 'nginx', 'cron', 'aaa', 'zzz'])
  })

  it('marks pm2 problems and never exposes extra fields', () => {
    const s = online({
      pm2: {
        available: true,
        daemon: true,
        online: 1,
        total: 2,
        procs: [
          { name: 'api', status: 'online', cpu: 3, memory: 50 * 1024 * 1024, restarts: 0, uptimeMs: 1 },
          { name: 'w', status: 'errored', cpu: 0, memory: 0, restarts: 9, uptimeMs: 0 }
        ]
      }
    })
    const g = buildGroup('pm2', s, 'few')!
    expect(g.tone).toBe('bad')
    expect(g.leaves[0]).toMatchObject({ label: 'w', tone: 'bad' })
    expect(g.leaves[1].sub).toContain('50 MB')
  })

  it('marks public ports', () => {
    const g = buildGroup('ports', online(), 'few')!
    expect(g.leaves.some((l) => l.tone === 'warn')).toBe(true)
    expect(g.leaves.every((l) => l.label.startsWith(':'))).toBe(true)
  })
})

describe('few / all', () => {
  const many = (n: number): ServerStatus =>
    online({ services: { available: true, running: Array.from({ length: n }, (_, i) => `svc-${String(i).padStart(2, '0')}`), failed: [] } })

  it('caps long lists with a "+N more" leaf and expands on request', () => {
    const few = buildGroup('services', many(30), 'few')!
    expect(few.leaves).toHaveLength(FEW + 1)
    expect(few.leaves[FEW]).toMatchObject({ kind: 'more', hidden: 22 })
    const all = buildGroup('services', many(30), 'all')!
    expect(all.leaves).toHaveLength(31)
    expect(all.leaves[30]).toMatchObject({ kind: 'more', hidden: 0 })
  })

  it('does not hide just one or two items', () => {
    expect(buildGroup('services', many(FEW + 2), 'few')!.leaves).toHaveLength(FEW + 2)
    expect(buildGroup('services', many(FEW + 2), 'few')!.leaves.some((l) => l.kind === 'more')).toBe(false)
  })

  it('has demo data for every group on every online demo server', () => {
    for (const s of DEMO_SERVERS.filter((d) => d.id !== 'demo-nas')) {
      const st = demoStatus(s.id)
      expect(buildGroup('services', st, 'few')).not.toBeNull()
      expect(buildGroup('ports', st, 'few')).not.toBeNull()
    }
  })
})
