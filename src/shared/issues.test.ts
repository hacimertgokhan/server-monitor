import { describe, expect, it } from 'vitest'
import { DEFAULT_THRESHOLDS, bySeverity, detectIssues, issueText, recoveredText } from './issues'
import type { ServerStatus } from './types'

const base = (over: Partial<ServerStatus> = {}): ServerStatus => ({
  id: 's1',
  state: 'online',
  checkedAt: 0,
  latencyMs: 10,
  cpu: 10,
  cores: 4,
  load: [0, 0, 0],
  memTotal: 8e9,
  memUsed: 1e9,
  memPct: 12,
  swapTotal: 0,
  swapUsed: 0,
  netRx: 0,
  netTx: 0,
  uptimeSec: 100,
  os: '',
  kernel: '',
  hostname: '',
  disks: [{ mount: '/', fs: 'ext4', size: 100, used: 40, pct: 40 }],
  docker: { available: true, running: 1, total: 1, containers: [{ name: 'web', image: 'nginx', state: 'running', status: 'Up' }] },
  pm2: {
    available: true,
    daemon: true,
    online: 1,
    total: 1,
    procs: [{ name: 'api', status: 'online', cpu: 0, memory: 0, restarts: 0, uptimeMs: 1 }]
  },
  services: { available: true, running: ['ssh'], failed: [] },
  ports: [],
  cpuHistory: [],
  memHistory: [],
  availability: { pct24h: 100, pct7d: 100, pct30d: 100, incidents24h: 0, trackedSince: 0 },
  ...over
})

describe('detectIssues', () => {
  it('finds nothing wrong on a healthy server, and nothing for unknown or connecting ones', () => {
    expect(detectIssues(base())).toEqual([])
    expect(detectIssues(undefined)).toEqual([])
    expect(detectIssues(base({ state: 'connecting' }))).toEqual([])
  })

  it('reports an unreachable server as a single bad issue', () => {
    expect(detectIssues(base({ state: 'offline', cpu: 99 }))).toEqual([
      { id: 's1:offline', serverId: 's1', kind: 'offline', severity: 'bad' }
    ])
  })

  it('applies the thresholds and escalates near saturation', () => {
    const th = { cpu: 80, ram: 85, disk: 90 }
    const i = detectIssues(base({ cpu: 82, memPct: 99, disks: [{ mount: '/data', fs: 'xfs', size: 1, used: 1, pct: 91 }] }), th)
    expect(i.map((x) => [x.kind, x.severity])).toEqual([
      ['cpu', 'warn'],
      ['ram', 'bad'],
      ['disk', 'warn']
    ])
    expect(i[2].names).toEqual(['/data'])
    expect(detectIssues(base({ cpu: 89 }), DEFAULT_THRESHOLDS)).toEqual([])
  })

  it('groups stopped containers, errored pm2 processes and failed services', () => {
    const i = detectIssues(
      base({
        docker: {
          available: true,
          running: 0,
          total: 2,
          containers: [
            { name: 'a', image: 'x', state: 'exited', status: '' },
            { name: 'b', image: 'x', state: 'restarting', status: '' }
          ]
        },
        pm2: {
          available: true,
          daemon: true,
          online: 0,
          total: 1,
          procs: [{ name: 'w', status: 'errored', cpu: 0, memory: 0, restarts: 3, uptimeMs: 0 }]
        },
        services: { available: true, running: [], failed: ['fail2ban', 'mysql'] }
      })
    )
    expect(i.map((x) => [x.kind, x.severity, x.names])).toEqual([
      ['docker', 'warn', ['a', 'b']],
      ['pm2', 'bad', ['w']],
      ['service', 'bad', ['fail2ban', 'mysql']]
    ])
  })

  it('ignores groups the server does not have', () => {
    const i = detectIssues(
      base({
        docker: { available: false, running: 0, total: 0, containers: [] },
        pm2: { available: false, daemon: false, online: 0, total: 0, procs: [] }
      })
    )
    expect(i).toEqual([])
  })

  it('sorts bad before warn', () => {
    const i = [{ severity: 'warn' }, { severity: 'bad' }, { severity: 'warn' }] as never[]
    expect([...i].sort(bySeverity).map((x: { severity: string }) => x.severity)).toEqual(['bad', 'warn', 'warn'])
  })
})

describe('issueText', () => {
  it('speaks English and Turkish, and truncates long name lists', () => {
    const disk = detectIssues(base({ disks: [{ mount: '/', fs: 'ext4', size: 1, used: 1, pct: 93.4 }] }))[0]
    expect(issueText(disk, 'en')).toBe('Disk / is 93% full')
    expect(issueText(disk, 'tr')).toBe('/ diski %93 dolu')
    const many = { id: 'x', serverId: 's', kind: 'service' as const, severity: 'bad' as const, names: ['a', 'b', 'c', 'd', 'e', 'f'] }
    expect(issueText(many, 'en')).toBe('6 service(s) failed: a, b, c, d +2')
    expect(recoveredText('tr')).toBe('Yeniden çevrimiçi')
  })
})
