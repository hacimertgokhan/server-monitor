import type { ContainerInfo, DiskInfo, PortInfo, Pm2Proc, ServerStatus } from '@shared/types'

/**
 * Read-only shell probes executed over SSH. Nothing here writes to the remote host.
 * FAST runs every poll (cpu/mem/load/net/uptime); SLOW runs every ~15s (docker/pm2/services/ports/disks).
 */
export const FAST_SCRIPT = `export LC_ALL=C
echo '@@CPU'; head -n1 /proc/stat
echo '@@LOAD'; cat /proc/loadavg
echo '@@MEM'; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo
echo '@@UP'; cat /proc/uptime
echo '@@NET'; cat /proc/net/dev
echo '@@END'
`

export const SLOW_SCRIPT = `export LC_ALL=C
echo '@@OS'
( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" ) || echo unknown
uname -r
hostname
echo '@@CORES'; (nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)
echo '@@DISK'; df -PT -B1 2>/dev/null | tail -n +2
echo '@@DOCKER'
if command -v docker >/dev/null 2>&1; then
  docker ps -a --format '{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}' 2>&1 | head -n 80
else echo '__NONE__'; fi
echo '@@PM2'
PM2=$(command -v pm2 2>/dev/null)
if [ -z "$PM2" ]; then for p in /usr/local/bin/pm2 /usr/bin/pm2 "$HOME/.npm-global/bin/pm2" "$HOME/.local/bin/pm2"; do [ -x "$p" ] && PM2=$p && break; done; fi
if [ -z "$PM2" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; PM2=$(command -v pm2 2>/dev/null); fi
if [ -z "$PM2" ]; then echo '__NONE__'
elif [ ! -S "\${PM2_HOME:-$HOME/.pm2}/rpc.sock" ]; then echo '__IDLE__'
else "$PM2" jlist 2>/dev/null | grep -m1 -E '^\\[(\\{|\\])'; fi
echo '@@SVC'
if command -v systemctl >/dev/null 2>&1; then
  systemctl list-units --type=service --state=running --no-legend --plain --no-pager 2>/dev/null | awk '{n=$1; if (n=="●"||n=="*") n=$2; print "R "n}'
  systemctl list-units --type=service --state=failed --no-legend --plain --no-pager 2>/dev/null | awk '{n=$1; if (n=="●"||n=="*") n=$2; print "F "n}'
else echo '__NONE__'; fi
echo '@@PORTS'
if command -v ss >/dev/null 2>&1; then ss -H -tulnp 2>/dev/null
elif command -v netstat >/dev/null 2>&1; then netstat -tulnp 2>/dev/null | tail -n +3
else echo '__NONE__'; fi
echo '@@END'
`

export function splitSections(out: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {}
  let cur: string | null = null
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const m = /^@@([A-Z0-9]+)$/.exec(line)
    if (m) {
      cur = m[1]
      sections[cur] = []
    } else if (cur) {
      sections[cur].push(line)
    }
  }
  return sections
}

export interface CpuSample {
  total: number
  idle: number
}

export function parseCpu(lines: string[]): CpuSample | null {
  const l = lines[0]
  if (!l || !l.startsWith('cpu')) return null
  const n = l.trim().split(/\s+/).slice(1).map(Number)
  if (n.length < 4 || n.some(Number.isNaN)) return null
  const idle = n[3] + (n[4] || 0) // idle + iowait
  const total = n.slice(0, 8).reduce((a, b) => a + b, 0)
  return { total, idle }
}

export function cpuPct(prev: CpuSample, cur: CpuSample): number {
  const dt = cur.total - prev.total
  const di = cur.idle - prev.idle
  if (dt <= 0) return 0
  return Math.max(0, Math.min(100, (1 - di / dt) * 100))
}

export interface NetSample {
  rx: number
  tx: number
}

const SKIP_IF = /^(lo|veth|docker|br-|virbr|cni|flannel|cali|tun|tap|kube)/

export function parseNet(lines: string[]): NetSample {
  let rx = 0
  let tx = 0
  for (const l of lines) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(l)
    if (!m || SKIP_IF.test(m[1])) continue
    const f = m[2].trim().split(/\s+/).map(Number)
    if (f.length < 9) continue
    rx += f[0]
    tx += f[8]
  }
  return { rx, tx }
}

export function parseMem(lines: string[]) {
  const kv: Record<string, number> = {}
  for (const l of lines) {
    const m = /^(\w+):\s+(\d+)/.exec(l)
    if (m) kv[m[1]] = Number(m[2]) * 1024
  }
  const total = kv.MemTotal || 0
  const avail = kv.MemAvailable ?? 0
  const used = Math.max(0, total - avail)
  const swapTotal = kv.SwapTotal || 0
  const swapUsed = Math.max(0, swapTotal - (kv.SwapFree || 0))
  return { total, used, pct: total ? (used / total) * 100 : 0, swapTotal, swapUsed }
}

const SKIP_FS = new Set(['tmpfs', 'devtmpfs', 'squashfs', 'overlay', 'efivarfs', 'ramfs', 'proc', 'sysfs', 'cgroup2'])
const SKIP_MOUNT = /^\/(run|sys|proc|dev|snap|var\/lib\/docker|var\/lib\/containers)(\/|$)/

export function parseDisks(lines: string[]): DiskInfo[] {
  const seen = new Set<string>()
  const disks: DiskInfo[] = []
  for (const l of lines) {
    const p = l.trim().split(/\s+/)
    if (p.length < 7) continue
    const [dev, fs, size, used] = [p[0], p[1], Number(p[2]), Number(p[3])]
    const mount = p.slice(6).join(' ')
    // overlay is normally docker internals, but on container-based VPS (LXC/OpenVZ) it *is* the root volume.
    const skipFs = SKIP_FS.has(fs) && !(fs === 'overlay' && mount === '/')
    if (skipFs || SKIP_MOUNT.test(mount) || !size || seen.has(dev)) continue
    seen.add(dev)
    disks.push({ mount, fs, size, used, pct: Math.min(100, (used / size) * 100) })
  }
  return disks.sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : a.mount.localeCompare(b.mount)))
}

export function parseDocker(lines: string[]): ServerStatus['docker'] {
  const clean = lines.filter(Boolean)
  if (clean[0] === '__NONE__') return { available: false, running: 0, total: 0, containers: [] }
  // Permission / daemon errors show up as free text without '|' separators.
  const containers: ContainerInfo[] = []
  for (const l of clean) {
    const p = l.split('|')
    if (p.length < 4) continue
    containers.push({ name: p[0], image: p[1], state: p[2], status: p.slice(3).join('|') })
  }
  const errored = clean.length > 0 && containers.length === 0
  return {
    available: !errored,
    running: containers.filter((c) => c.state === 'running').length,
    total: containers.length,
    containers
  }
}

/** The subset of `pm2 jlist` we read; everything else (notably pm2_env.env) is ignored. */
interface Pm2Raw {
  name?: unknown
  pm2_env?: { status?: unknown; restart_time?: unknown; pm_uptime?: unknown }
  monit?: { cpu?: unknown; memory?: unknown }
}

export function parsePm2(lines: string[]): ServerStatus['pm2'] {
  const first = lines.find(Boolean)
  if (!first || first === '__NONE__') return { available: false, daemon: false, online: 0, total: 0, procs: [] }
  if (first === '__IDLE__') return { available: true, daemon: false, online: 0, total: 0, procs: [] }
  try {
    const raw = JSON.parse(first) as Pm2Raw[]
    // Only whitelisted fields are kept — pm2_env carries the full process environment (may hold secrets).
    const procs: Pm2Proc[] = raw.map((p) => ({
      name: String(p.name),
      status: String(p.pm2_env?.status ?? 'unknown'),
      cpu: Number(p.monit?.cpu ?? 0),
      memory: Number(p.monit?.memory ?? 0),
      restarts: Number(p.pm2_env?.restart_time ?? 0),
      uptimeMs: p.pm2_env?.pm_uptime ? Math.max(0, Date.now() - Number(p.pm2_env.pm_uptime)) : 0
    }))
    return {
      available: true,
      daemon: true,
      online: procs.filter((p) => p.status === 'online').length,
      total: procs.length,
      procs
    }
  } catch {
    return { available: true, daemon: false, online: 0, total: 0, procs: [] }
  }
}

export function parseServices(lines: string[]): ServerStatus['services'] {
  const clean = lines.filter(Boolean)
  if (clean[0] === '__NONE__') return { available: false, running: [], failed: [] }
  const running: string[] = []
  const failed: string[] = []
  for (const l of clean) {
    const m = /^([RF])\s+(?:●\s*)?(\S+)/.exec(l)
    if (!m) continue
    const name = m[2].replace(/\.service$/, '')
    if (m[1] === 'R') running.push(name)
    else failed.push(name)
  }
  return { available: true, running: running.sort(), failed: failed.sort() }
}

function splitAddr(a: string): { host: string; port: number } | null {
  const i = a.lastIndexOf(':')
  if (i < 0) return null
  const port = Number(a.slice(i + 1))
  if (!Number.isFinite(port)) return null
  return { host: a.slice(0, i).replace(/^\[|\]$/g, ''), port }
}

export function parsePorts(lines: string[]): PortInfo[] {
  const map = new Map<string, PortInfo>()
  for (const l of lines) {
    const p = l.trim().split(/\s+/)
    if (p.length < 5 || p[0] === '__NONE__') continue
    let proto: 'tcp' | 'udp'
    let local: string
    let rest: string
    if (p[0].startsWith('tcp')) proto = 'tcp'
    else if (p[0].startsWith('udp')) proto = 'udp'
    else continue
    if (/^\d+$/.test(p[1])) {
      // netstat: proto recvq sendq local foreign [state] [pid/prog]
      local = p[3]
      rest = p.slice(5).join(' ')
      const pm = /(\d+)\/(\S+)/.exec(rest)
      rest = pm ? `users:(("${pm[2]}"))` : ''
    } else {
      // ss: netid state recvq sendq local peer [users:(...)]
      local = p[4]
      rest = p.slice(6).join(' ')
    }
    const a = splitAddr(local)
    if (!a) continue
    const proc = /\(\("([^"]+)"/.exec(rest)?.[1]
    const loopback = /^(127\.|::1$|localhost)/.test(a.host)
    const key = `${proto}:${a.port}`
    const prev = map.get(key)
    if (prev) {
      if (!loopback) prev.exposure = 'public'
      if (!prev.process && proc) prev.process = proc
    } else {
      map.set(key, { port: a.port, proto, exposure: loopback ? 'local' : 'public', process: proc })
    }
  }
  return [...map.values()].sort((a, b) => a.port - b.port)
}
