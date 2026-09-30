import type { ServerInfo, ServerStatus } from '@shared/types'

/** Synthetic servers so the UI can be previewed (and tweaked) without any SSH connection. */
export const DEMO_SERVERS: ServerInfo[] = [
  { id: 'demo-web', name: 'web-prod-01', host: '203.0.113.10', port: 22, username: 'deploy', authType: 'key' },
  { id: 'demo-db', name: 'db-master', host: '203.0.113.21', port: 22, username: 'root', authType: 'key' },
  { id: 'demo-api', name: 'api-eu', host: '198.51.100.7', port: 22, username: 'ubuntu', authType: 'key' },
  { id: 'demo-worker', name: 'worker-01', host: '198.51.100.42', port: 22, username: 'deploy', authType: 'password' },
  { id: 'demo-nas', name: 'backup-nas', host: '192.0.2.50', port: 2222, username: 'admin', authType: 'password' }
]

interface Profile {
  cpu: number
  mem: number
  disk: number
  cores: number
  memTotal: number
  os: string
  docker: [number, number]
  pm2: [number, number]
  services: number
  failed: string[]
  ports: number[]
  uptimeDays: number
  offline?: boolean
}

const PROFILES: Record<string, Profile> = {
  'demo-web': {
    cpu: 34,
    mem: 58,
    disk: 46,
    cores: 4,
    memTotal: 8,
    os: 'Ubuntu 22.04.4 LTS',
    docker: [8, 8],
    pm2: [4, 4],
    services: 31,
    failed: [],
    ports: [22, 80, 443, 3000, 9100],
    uptimeDays: 92
  },
  'demo-db': {
    cpu: 18,
    mem: 81,
    disk: 78,
    cores: 8,
    memTotal: 32,
    os: 'Debian GNU/Linux 12',
    docker: [0, 0],
    pm2: [0, 0],
    services: 27,
    failed: [],
    ports: [22, 3306, 9104],
    uptimeDays: 211
  },
  'demo-api': {
    cpu: 72,
    mem: 66,
    disk: 52,
    cores: 4,
    memTotal: 16,
    os: 'Ubuntu 24.04 LTS',
    docker: [5, 6],
    pm2: [3, 3],
    services: 29,
    failed: [],
    ports: [22, 80, 443, 8080, 6379],
    uptimeDays: 14
  },
  'demo-worker': {
    cpu: 91,
    mem: 88,
    disk: 63,
    cores: 2,
    memTotal: 4,
    os: 'Ubuntu 20.04.6 LTS',
    docker: [2, 2],
    pm2: [2, 3],
    services: 24,
    failed: ['fail2ban'],
    ports: [22, 5672],
    uptimeDays: 3
  },
  'demo-nas': {
    cpu: 0,
    mem: 0,
    disk: 0,
    cores: 0,
    memTotal: 0,
    os: '',
    docker: [0, 0],
    pm2: [0, 0],
    services: 0,
    failed: [],
    ports: [],
    uptimeDays: 0,
    offline: true
  }
}

const GB = 1024 ** 3
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
const walk = (v: number, step: number, lo = 1, hi = 99): number => clamp(v + (Math.random() - 0.5) * step, lo, hi)
const push = (h: number[], v: number): number[] => [...h, v].slice(-60)

export function demoStatus(id: string, prev?: ServerStatus): ServerStatus {
  const p = PROFILES[id]
  const now = Date.now()
  if (p.offline) {
    return {
      ...(prev ?? blank(id)),
      state: 'offline',
      error: 'Connection timed out',
      checkedAt: now,
      netRx: 0,
      netTx: 0,
      availability: {
        pct24h: 97.12,
        pct7d: 99.4,
        pct30d: 99.71,
        incidents24h: 2,
        trackedSince: now - 9 * 86400_000,
        downSince: now - 47 * 60_000
      }
    }
  }
  const base = prev ?? blank(id)
  const cpu = prev ? walk(prev.cpu, 14, 2, 99) : p.cpu
  const mem = prev ? walk(prev.memPct, 2, 20, 97) : p.mem
  const total = p.memTotal * GB
  const running = p.docker[0]
  return {
    ...base,
    state: 'online',
    checkedAt: now,
    latencyMs: Math.round(clamp((prev?.latencyMs ?? 30 + Math.random() * 60) + (Math.random() - 0.5) * 14, 8, 220)),
    cpu,
    cores: p.cores,
    load: [(cpu / 100) * p.cores, (cpu / 100) * p.cores * 0.9, (cpu / 100) * p.cores * 0.8].map((v) => Math.round(v * 100) / 100) as [
      number,
      number,
      number
    ],
    memTotal: total,
    memUsed: (mem / 100) * total,
    memPct: mem,
    swapTotal: 2 * GB,
    swapUsed: mem > 85 ? 0.7 * GB : 0.05 * GB,
    netRx: Math.max(0, (prev?.netRx ?? 400_000) * (0.8 + Math.random() * 0.4)),
    netTx: Math.max(0, (prev?.netTx ?? 150_000) * (0.8 + Math.random() * 0.4)),
    uptimeSec: (prev?.uptimeSec ?? p.uptimeDays * 86400 + 5000) + 2,
    os: p.os,
    kernel: '6.5.0-35-generic',
    hostname: PROFILES[id] && DEMO_SERVERS.find((s) => s.id === id)!.name,
    disks: [
      { mount: '/', fs: 'ext4', size: 80 * GB, used: (p.disk / 100) * 80 * GB, pct: p.disk },
      { mount: '/data', fs: 'xfs', size: 500 * GB, used: 0.31 * 500 * GB, pct: 31 }
    ],
    docker: {
      available: p.docker[1] > 0,
      running,
      total: p.docker[1],
      containers: Array.from({ length: p.docker[1] }, (_, i) => ({
        name: ['nginx', 'redis', 'app', 'worker', 'grafana', 'prometheus', 'mysql', 'cron'][i % 8],
        image: ['nginx:1.27', 'redis:7', 'app:latest', 'worker:latest', 'grafana:11', 'prom/prometheus', 'mysql:8', 'cron:1'][i % 8],
        state: i < running ? 'running' : 'exited',
        status: i < running ? `Up ${i + 2} days` : 'Exited (1) 3 hours ago'
      }))
    },
    pm2: {
      available: p.pm2[1] > 0,
      daemon: p.pm2[1] > 0,
      online: p.pm2[0],
      total: p.pm2[1],
      procs: Array.from({ length: p.pm2[1] }, (_, i) => ({
        name: ['api', 'web', 'queue', 'cron'][i % 4],
        status: i < p.pm2[0] ? 'online' : 'errored',
        cpu: Math.round(Math.random() * 30),
        memory: (60 + Math.random() * 120) * 1024 ** 2,
        restarts: i < p.pm2[0] ? 0 : 14,
        uptimeMs: (i + 1) * 3_600_000 * 7
      }))
    },
    services: {
      available: true,
      running: [
        'ssh',
        'cron',
        'docker',
        'nginx',
        'mysql',
        'redis-server',
        'rsyslog',
        'systemd-journald',
        'ufw',
        'fail2ban',
        'node_exporter'
      ].slice(0, Math.min(11, p.services)),
      failed: p.failed
    },
    ports: p.ports.map((port) => ({
      port,
      proto: 'tcp' as const,
      exposure: [22, 80, 443].includes(port) ? ('public' as const) : ('local' as const),
      process: (
        { 22: 'sshd', 80: 'nginx', 443: 'nginx', 3000: 'node', 3306: 'mysqld', 6379: 'redis-server', 8080: 'node' } as Record<
          number,
          string
        >
      )[port]
    })),
    cpuHistory: push(prev?.cpuHistory ?? Array.from({ length: 30 }, () => cpu), cpu),
    memHistory: push(prev?.memHistory ?? Array.from({ length: 30 }, () => mem), mem),
    availability: { pct24h: 99.98, pct7d: 99.95, pct30d: 99.97, incidents24h: 0, trackedSince: now - 30 * 86400_000 }
  }
}

function blank(id: string): ServerStatus {
  return {
    id,
    state: 'connecting',
    checkedAt: 0,
    latencyMs: 0,
    cpu: 0,
    cores: 0,
    load: [0, 0, 0],
    memTotal: 0,
    memUsed: 0,
    memPct: 0,
    swapTotal: 0,
    swapUsed: 0,
    netRx: 0,
    netTx: 0,
    uptimeSec: 0,
    os: '',
    kernel: '',
    hostname: '',
    disks: [],
    docker: { available: false, running: 0, total: 0, containers: [] },
    pm2: { available: false, daemon: false, online: 0, total: 0, procs: [] },
    services: { available: false, running: [], failed: [] },
    ports: [],
    cpuHistory: [],
    memHistory: [],
    availability: { pct24h: null, pct7d: null, pct30d: null, incidents24h: 0, trackedSince: Date.now() }
  }
}

/** Plausible log output in each tool's real format, so the log viewer can be previewed without a server. */
export function demoLogs(kind: 'docker' | 'pm2' | 'service', name: string, lines: number): string {
  const now = Date.now()
  const pick = <T>(a: T[], i: number): T => a[(i * 7 + name.length) % a.length]
  const msgs = [
    'GET /api/health 200 3ms',
    'GET /api/servers 200 18ms',
    'POST /api/login 200 41ms',
    'cache hit ratio 0.93',
    'worker heartbeat ok',
    'WARN slow query took 1240ms: SELECT * FROM orders WHERE status = ?',
    'listening on port 3000',
    'GET /static/app.js 304 1ms',
    'ERROR connect ECONNREFUSED 10.0.0.5:5432 (retrying in 5s)',
    'INFO scheduled job "cleanup" finished in 212ms',
    'DEBUG session store: 41 active sessions',
    'POST /api/webhook 202 9ms'
  ]
  const out: string[] = []
  const n = Math.min(lines, 400)
  if (kind === 'pm2') out.push(`/home/deploy/.pm2/logs/${name}-out.log last ${Math.ceil(n * 0.7)} lines:`)
  for (let i = 0; i < n; i++) {
    const t = new Date(now - (n - i) * 4200 - (i % 3) * 700)
    const iso = t.toISOString()
    const msg = pick(msgs, i)
    if (kind === 'docker') out.push(`${iso.replace('Z', '123456Z')} ${msg}`)
    else if (kind === 'service') out.push(`${iso.slice(0, 19)}+0000 srv1 ${name}[${800 + (i % 5)}]: ${msg}`)
    else {
      if (i === Math.ceil(n * 0.7)) out.push(`/home/deploy/.pm2/logs/${name}-error.log last ${Math.floor(n * 0.3)} lines:`)
      out.push(`${iso.slice(0, 19).replace('T', '-')}: ${msg}`)
    }
  }
  return out.join('\n') + '\n'
}
