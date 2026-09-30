import type { ExpandMode, GroupKey, ServerStatus } from '@shared/types'
import { formatBytes } from './utils'

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted'

export interface Leaf {
  id: string
  kind: 'docker' | 'pm2' | 'service' | 'port' | 'more'
  label: string
  /** Second line (image, cpu/memory, protocol …). */
  sub?: string
  tone: Tone
  /** For kind 'more': how many items are hidden (or 0 for "show fewer"). */
  hidden?: number
}

export interface BuiltGroup {
  key: GroupKey
  label: string
  /** e.g. "3/4" or "11 · 1 failed". */
  summary: string
  tone: Tone
  leaves: Leaf[]
  total: number
}

export const GROUP_KEYS: GroupKey[] = ['docker', 'pm2', 'services', 'ports']

/** How many items a collapsed-to-"few" group shows before "+N more". */
export const FEW = 8
const MORE_SLACK = 2 // never show "+1 more" / "+2 more": just show everything

/** Well-known daemons float to the top of the service list. */
const KEY_DAEMONS = [
  'nginx',
  'apache2',
  'httpd',
  'caddy',
  'docker',
  'containerd',
  'mysql',
  'mariadb',
  'postgresql',
  'redis-server',
  'redis',
  'mongod',
  'ssh',
  'sshd',
  'fail2ban',
  'ufw',
  'cron',
  'node_exporter'
]

const worst = (tones: Tone[]): Tone =>
  tones.includes('bad') ? 'bad' : tones.includes('warn') ? 'warn' : tones.includes('info') ? 'info' : tones.length ? 'ok' : 'muted'

function cap(all: Leaf[], mode: ExpandMode): Leaf[] {
  if (all.length <= FEW + MORE_SLACK) return all
  if (mode === 'all') return [...all, { id: 'more', kind: 'more', label: '', tone: 'muted', hidden: 0 }]
  return [...all.slice(0, FEW), { id: 'more', kind: 'more', label: '', tone: 'muted', hidden: all.length - FEW }]
}

/** Builds the sub-tree content for one group, or null when the server has nothing to show for it. */
export function buildGroup(key: GroupKey, s: ServerStatus | undefined, mode: ExpandMode): BuiltGroup | null {
  if (!s || s.state !== 'online') return null

  if (key === 'docker') {
    if (!s.docker.available) return null
    const rank = (c: { state: string }): number => (c.state === 'running' ? 1 : 0) // problems first
    const all: Leaf[] = [...s.docker.containers]
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .map((c) => ({
        id: `docker:${c.name}`,
        kind: 'docker' as const,
        label: c.name,
        sub: `${c.image} · ${c.status}`,
        tone: c.state === 'running' ? 'ok' : c.state === 'restarting' ? 'warn' : 'bad'
      }))
    const warn = s.docker.running < s.docker.total
    return {
      key,
      label: 'Docker',
      summary: `${s.docker.running}/${s.docker.total}`,
      tone: warn ? 'warn' : 'ok',
      leaves: cap(all, mode),
      total: all.length
    }
  }

  if (key === 'pm2') {
    if (!s.pm2.available || !s.pm2.daemon) return null
    const all: Leaf[] = [...s.pm2.procs]
      .sort((a, b) => Number(a.status === 'online') - Number(b.status === 'online') || a.name.localeCompare(b.name))
      .map((p) => ({
        id: `pm2:${p.name}`,
        kind: 'pm2' as const,
        label: p.name,
        sub: p.status === 'online' ? `CPU ${p.cpu}% · ${formatBytes(p.memory, 0)} · ↻${p.restarts}` : `${p.status} · ↻${p.restarts}`,
        tone: p.status === 'online' ? 'ok' : 'bad'
      }))
    return {
      key,
      label: 'PM2',
      summary: `${s.pm2.online}/${s.pm2.total}`,
      tone: s.pm2.online < s.pm2.total ? 'bad' : 'ok',
      leaves: cap(all, mode),
      total: all.length
    }
  }

  if (key === 'services') {
    if (!s.services.available) return null
    const rank = (n: string): number => {
      const i = KEY_DAEMONS.indexOf(n)
      return i < 0 ? KEY_DAEMONS.length : i
    }
    const running = [...s.services.running].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    const all: Leaf[] = [
      ...s.services.failed.map((n) => ({ id: `svc:f:${n}`, kind: 'service' as const, label: n, sub: 'failed', tone: 'bad' as Tone })),
      ...running.map((n) => ({ id: `svc:r:${n}`, kind: 'service' as const, label: n, tone: 'ok' as Tone }))
    ]
    const failed = s.services.failed.length
    return {
      key,
      label: 'Services',
      summary: failed ? `${s.services.running.length} · ${failed}✗` : `${s.services.running.length}`,
      tone: failed ? 'bad' : 'ok',
      leaves: cap(all, mode),
      total: all.length
    }
  }

  // ports
  const all: Leaf[] = s.ports.map((p) => ({
    id: `port:${p.proto}:${p.port}`,
    kind: 'port' as const,
    label: `:${p.port}`,
    sub: `${p.proto}${p.process ? ` · ${p.process}` : ''}`,
    tone: p.exposure === 'public' ? 'warn' : 'muted'
  }))
  if (all.length === 0) return null
  return {
    key,
    label: 'Ports',
    summary: `${all.length}`,
    tone: worst(all.map((l) => l.tone)) === 'warn' ? 'info' : 'muted',
    leaves: cap(all, mode),
    total: all.length
  }
}
