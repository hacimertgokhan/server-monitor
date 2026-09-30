import { describe, expect, it } from 'vitest'
import {
  LOG_LINES_MAX,
  LOG_LINES_MIN,
  LOG_MAX_BYTES,
  SAFE_NAME,
  buildLogScript,
  cpuPct,
  logBody,
  parseCpu,
  parseDisks,
  parseDocker,
  parseMem,
  parseNet,
  parsePm2,
  parsePorts,
  parseServices,
  splitSections
} from './probe'

describe('parsePorts', () => {
  it('parses ss output, merges IPv4/IPv6 and flags exposure', () => {
    const ss = [
      'tcp   LISTEN 0      4096         0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=812,fd=3))',
      'tcp   LISTEN 0      511          0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=901,fd=6),("nginx",pid=900,fd=6))',
      'tcp   LISTEN 0      4096       127.0.0.1:3306       0.0.0.0:*    users:(("mysqld",pid=1022,fd=21))',
      'tcp   LISTEN 0      4096            [::]:22            [::]:*    users:(("sshd",pid=812,fd=4))',
      'tcp   LISTEN 0      128            [::1]:631           [::]:*',
      'udp   UNCONN 0      0        127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=500,fd=13))',
      'udp   UNCONN 0      0            0.0.0.0:68         0.0.0.0:*'
    ]
    expect(parsePorts(ss)).toEqual([
      { port: 22, proto: 'tcp', exposure: 'public', process: 'sshd' },
      { port: 53, proto: 'udp', exposure: 'local', process: 'systemd-resolve' },
      { port: 68, proto: 'udp', exposure: 'public' },
      { port: 80, proto: 'tcp', exposure: 'public', process: 'nginx' },
      { port: 631, proto: 'tcp', exposure: 'local' },
      { port: 3306, proto: 'tcp', exposure: 'local', process: 'mysqld' }
    ])
  })

  it('falls back to netstat format', () => {
    const ns = [
      'tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      812/sshd',
      'tcp6       0      0 :::8080                 :::*                    LISTEN      1500/node',
      'udp        0      0 127.0.0.1:323           0.0.0.0:*                           600/chronyd'
    ]
    expect(parsePorts(ns).map((p) => [p.port, p.proto, p.exposure, p.process])).toEqual([
      [22, 'tcp', 'public', 'sshd'],
      [323, 'udp', 'local', 'chronyd'],
      [8080, 'tcp', 'public', 'node']
    ])
  })
})

describe('parseServices', () => {
  it('splits running and failed units, tolerating the bullet marker', () => {
    expect(parseServices(['R ssh.service', 'R nginx.service', 'F fail2ban.service', 'F mysql.service'])).toEqual({
      available: true,
      running: ['nginx', 'ssh'],
      failed: ['fail2ban', 'mysql']
    })
  })
  it('reports unavailable without systemd', () => {
    expect(parseServices(['__NONE__']).available).toBe(false)
  })
})

describe('parseDocker', () => {
  it('counts running containers', () => {
    const d = parseDocker([
      'web|nginx:1.27|running|Up 3 days',
      'db|postgres:17|exited|Exited (1) 2 hours ago',
      'x|redis|restarting|Restarting (1) 5 seconds ago'
    ])
    expect([d.available, d.running, d.total]).toEqual([true, 1, 3])
  })
  it('treats permission errors and missing docker as unavailable', () => {
    expect(parseDocker(['permission denied while trying to connect to the Docker daemon socket']).available).toBe(false)
    expect(parseDocker(['__NONE__']).available).toBe(false)
  })
  it('handles a reachable daemon with no containers', () => {
    expect(parseDocker([])).toEqual({ available: true, running: 0, total: 0, containers: [] })
  })
})

describe('parsePm2', () => {
  const json = JSON.stringify([
    {
      name: 'api',
      pm2_env: { status: 'online', restart_time: 2, pm_uptime: Date.now() - 60_000, env: { SECRET: 'hunter2' } },
      monit: { cpu: 3, memory: 52428800 }
    },
    { name: 'w', pm2_env: { status: 'errored', restart_time: 15 }, monit: { cpu: 0, memory: 0 } }
  ])
  it('counts online processes', () => {
    const p = parsePm2([json])
    expect([p.available, p.daemon, p.online, p.total]).toEqual([true, true, 1, 2])
  })
  it('never keeps the process environment (may contain secrets)', () => {
    expect(JSON.stringify(parsePm2([json]))).not.toContain('hunter2')
  })
  it('distinguishes idle daemon, missing pm2 and garbage', () => {
    expect(parsePm2(['__IDLE__'])).toEqual({ available: true, daemon: false, online: 0, total: 0, procs: [] })
    expect(parsePm2(['__NONE__']).available).toBe(false)
    expect(parsePm2(['[not json']).daemon).toBe(false)
  })
})

describe('parseDisks', () => {
  it('skips pseudo filesystems, docker internals and duplicate devices', () => {
    const rows = [
      '/dev/sda1 ext4 100000000000 40000000000 55000000000 43% /',
      '/dev/sdb1 xfs 500000000000 100000000000 400000000000 20% /data',
      'tmpfs tmpfs 1000 0 1000 0% /run',
      '/dev/sda1 ext4 100000000000 40000000000 55000000000 43% /var/lib/docker/plugins',
      'overlay overlay 1000 100 900 10% /var/lib/docker/overlay2/x/merged'
    ]
    expect(parseDisks(rows).map((d) => [d.mount, Math.round(d.pct)])).toEqual([
      ['/', 40],
      ['/data', 20]
    ])
  })
  it('keeps an overlay root (LXC/OpenVZ style hosts)', () => {
    expect(parseDisks(['overlay overlay 1000 100 900 10% /'])).toHaveLength(1)
  })
})

describe('counters', () => {
  it('computes cpu percentage between two samples', () => {
    const a = parseCpu(['cpu  100 0 100 800 0 0 0 0 0 0'])!
    const b = parseCpu(['cpu  150 0 150 900 0 0 0 0 0 0'])!
    expect(Math.round(cpuPct(a, b))).toBe(50)
  })
  it('sums traffic over real interfaces only', () => {
    const lines = [
      'Inter-|   Receive',
      ' face |bytes',
      '    lo: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0',
      '  eth0: 1000 5 0 0 0 0 0 0 2000 4 0 0 0 0 0 0',
      'docker0: 500 1 0 0 0 0 0 0 500 1 0 0 0 0 0 0'
    ]
    expect(parseNet(lines)).toEqual({ rx: 1000, tx: 2000 })
  })
  it('derives used memory from MemAvailable', () => {
    const m = parseMem(['MemTotal: 8000000 kB', 'MemAvailable: 2000000 kB', 'SwapTotal: 1000 kB', 'SwapFree: 400 kB'])
    expect([m.total, m.used, Math.round(m.pct), m.swapUsed]).toEqual([8192000000, 6144000000, 75, 614400])
  })
})

describe('splitSections', () => {
  it('handles CRLF and multiple sections', () => {
    expect(Object.keys(splitSections('@@A\r\nx\r\n@@B\r\ny'))).toEqual(['A', 'B'])
  })
})

describe('buildLogScript', () => {
  it('builds read-only tail commands for each kind', () => {
    const docker = buildLogScript('docker', 'web-1', 200)!
    expect(docker).toContain("docker logs --tail 200 --timestamps 'web-1' 2>&1")
    expect(docker.trim().endsWith("echo '@@END'")).toBe(true)
    expect(buildLogScript('pm2', 'api', 50)).toContain("logs 'api' --nostream --lines 50")
    expect(buildLogScript('service', 'nginx', 100)).toContain("journalctl -u 'nginx' -n 100 --no-pager")
  })

  it('never lets a name break out of the quotes', () => {
    const bad = [
      "a'b",
      'a b',
      'a;rm -rf /',
      '$(id)',
      '`id`',
      'a|b',
      'a&&b',
      'a\nb',
      '../x',
      '-rf',
      '',
      'x'.repeat(200),
      "web'; touch /tmp/pwn; '"
    ]
    for (const name of bad) {
      expect(buildLogScript('docker', name, 100), name).toBeNull()
      expect(buildLogScript('pm2', name, 100), name).toBeNull()
      expect(buildLogScript('service', name, 100), name).toBeNull()
    }
    for (const ok of ['web', 'my_app.v2', 'redis-server', 'nginx@1', 'app:latest']) expect(SAFE_NAME.test(ok), ok).toBe(true)
  })

  it('clamps the line count and caps the response size', () => {
    expect(buildLogScript('docker', 'a', 1)).toContain(`--tail ${LOG_LINES_MIN} `)
    expect(buildLogScript('docker', 'a', 999999)).toContain(`--tail ${LOG_LINES_MAX} `)
    expect(buildLogScript('docker', 'a', Number.NaN)).toContain('--tail 200 ')
    expect(buildLogScript('docker', 'a', 100)).toContain(`tail -c ${LOG_MAX_BYTES}`)
  })

  it('only queries PM2 when its daemon already runs (jlist/logs would otherwise start one)', () => {
    expect(buildLogScript('pm2', 'api', 100)).toContain('rpc.sock')
  })
})

describe('logBody', () => {
  it('returns the output before the end marker and detects truncation', () => {
    expect(logBody(['line1', 'line2', '@@END', ''].join('\r\n'))).toBe('line1\nline2\n')
    expect(logBody('partial output')).toBeNull()
    expect(logBody('@@END\n')).toBe('')
  })
})
