import type { ServerStatus } from './types'

/** Problems worth telling the user about. Pure and shared, so the UI and the notifier agree on what a "problem" is. */
export type IssueKind = 'offline' | 'cpu' | 'ram' | 'disk' | 'docker' | 'pm2' | 'service'
export type Severity = 'warn' | 'bad'

export interface Thresholds {
  cpu: number
  ram: number
  disk: number
}

export const DEFAULT_THRESHOLDS: Thresholds = { cpu: 90, ram: 90, disk: 90 }

export interface Issue {
  /** Stable per server + kind (+ mount), so a recurring problem is recognised as the same one. */
  id: string
  serverId: string
  kind: IssueKind
  severity: Severity
  /** Percentage for cpu/ram/disk. */
  value?: number
  /** Container / process / service names for docker, pm2 and service issues; the mount point for disk. */
  names?: string[]
}

const NAME_LIMIT = 4

export function detectIssues(s: ServerStatus | undefined, th: Thresholds = DEFAULT_THRESHOLDS): Issue[] {
  if (!s) return []
  const id = s.id
  if (s.state === 'offline') return [{ id: `${id}:offline`, serverId: id, kind: 'offline', severity: 'bad' }]
  if (s.state !== 'online') return []

  const out: Issue[] = []
  if (s.cpu >= th.cpu) out.push({ id: `${id}:cpu`, serverId: id, kind: 'cpu', severity: s.cpu >= 98 ? 'bad' : 'warn', value: s.cpu })
  if (s.memPct >= th.ram)
    out.push({ id: `${id}:ram`, serverId: id, kind: 'ram', severity: s.memPct >= 98 ? 'bad' : 'warn', value: s.memPct })
  for (const d of s.disks) {
    if (d.pct >= th.disk)
      out.push({
        id: `${id}:disk:${d.mount}`,
        serverId: id,
        kind: 'disk',
        severity: d.pct >= 97 ? 'bad' : 'warn',
        value: d.pct,
        names: [d.mount]
      })
  }
  const stopped = s.docker.containers.filter((c) => c.state !== 'running').map((c) => c.name)
  if (s.docker.available && stopped.length) out.push({ id: `${id}:docker`, serverId: id, kind: 'docker', severity: 'warn', names: stopped })
  const bad = s.pm2.procs.filter((p) => p.status !== 'online').map((p) => p.name)
  if (s.pm2.available && s.pm2.daemon && bad.length) out.push({ id: `${id}:pm2`, serverId: id, kind: 'pm2', severity: 'bad', names: bad })
  if (s.services.available && s.services.failed.length)
    out.push({ id: `${id}:service`, serverId: id, kind: 'service', severity: 'bad', names: s.services.failed })
  return out
}

export type IssueLang = 'en' | 'tr'

const list = (names: string[] | undefined): string => {
  const n = names ?? []
  return n.length > NAME_LIMIT ? `${n.slice(0, NAME_LIMIT).join(', ')} +${n.length - NAME_LIMIT}` : n.join(', ')
}

const TEXT: Record<IssueLang, Record<IssueKind, (i: Issue) => string> & { recovered: string; offlineTitle: string }> = {
  en: {
    offline: () => 'Server is unreachable',
    cpu: (i) => `CPU is at ${Math.round(i.value ?? 0)}%`,
    ram: (i) => `Memory is at ${Math.round(i.value ?? 0)}%`,
    disk: (i) => `Disk ${list(i.names)} is ${Math.round(i.value ?? 0)}% full`,
    docker: (i) => `${(i.names ?? []).length} container(s) not running: ${list(i.names)}`,
    pm2: (i) => `${(i.names ?? []).length} PM2 process(es) not online: ${list(i.names)}`,
    service: (i) => `${(i.names ?? []).length} service(s) failed: ${list(i.names)}`,
    recovered: 'Back online',
    offlineTitle: 'is offline'
  },
  tr: {
    offline: () => 'Sunucuya ulaşılamıyor',
    cpu: (i) => `CPU %${Math.round(i.value ?? 0)}`,
    ram: (i) => `Bellek %${Math.round(i.value ?? 0)}`,
    disk: (i) => `${list(i.names)} diski %${Math.round(i.value ?? 0)} dolu`,
    docker: (i) => `${(i.names ?? []).length} konteyner çalışmıyor: ${list(i.names)}`,
    pm2: (i) => `${(i.names ?? []).length} PM2 süreci online değil: ${list(i.names)}`,
    service: (i) => `${(i.names ?? []).length} servis hatalı: ${list(i.names)}`,
    recovered: 'Yeniden çevrimiçi',
    offlineTitle: 'çevrimdışı'
  }
}

export const issueText = (issue: Issue, lang: IssueLang): string => TEXT[lang][issue.kind](issue)
export const recoveredText = (lang: IssueLang): string => TEXT[lang].recovered

/** Worst-first ordering used by the issues list. */
export const bySeverity = (a: Issue, b: Issue): number => Number(b.severity === 'bad') - Number(a.severity === 'bad')
