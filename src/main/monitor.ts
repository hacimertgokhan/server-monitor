import { Client } from 'ssh2'
import type { ConnectConfig } from 'ssh2'
import { readFileSync } from 'fs'
import { EventEmitter } from 'events'
import type { ServerStatus, TestResult } from '@shared/types'
import type { ServerSecrets } from './store'
import { availability, getSecrets, pinHostKey, recordCheck } from './store'
import {
  FAST_SCRIPT,
  SLOW_SCRIPT,
  cpuPct,
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
import type { CpuSample, NetSample } from './probe'

const HISTORY = 60
const SLOW_EVERY_MS = 15_000
const EXEC_TIMEOUT_MS = 20_000

function emptyStatus(id: string): ServerStatus {
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
    availability: availability(id)
  }
}

function buildConnectConfig(s: ServerSecrets, onHostKey?: (fp: string) => boolean): ConnectConfig {
  const cfg: ConnectConfig = {
    host: s.host,
    port: s.port,
    username: s.username,
    readyTimeout: 12_000,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
    hostHash: 'sha256',
    hostVerifier: ((fp: string) => (onHostKey ? onHostKey(fp) : true)) as unknown as ConnectConfig['hostVerifier']
  }
  if (s.authType === 'key') {
    if (!s.keyPath) throw new Error('No private key file selected')
    cfg.privateKey = readFileSync(s.keyPath)
    if (s.passphrase) cfg.passphrase = s.passphrase
  } else {
    cfg.password = s.password
    cfg.tryKeyboard = true
  }
  return cfg
}

/** Every probe script ends with an `@@END` marker; a missing marker means the connection died mid-command. */
function run(client: Client, cmd: string, timeoutMs = EXEC_TIMEOUT_MS, requireEnd = true): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Command timed out')), timeoutMs)
    // Prefer bash (needed to source nvm for pm2 detection); fall back to plain sh.
    client.exec(`B=$(command -v bash || echo sh); "$B" -c ${shQuote(cmd)}`, (err, stream) => {
      if (err) {
        clearTimeout(t)
        return reject(err)
      }
      let out = ''
      stream.on('data', (d: Buffer) => (out += d.toString('utf8')))
      stream.stderr.on('data', () => undefined)
      stream.on('close', () => {
        clearTimeout(t)
        if (requireEnd && !out.includes('@@END')) reject(new Error('Connection closed'))
        else resolve(out)
      })
    })
  })
}

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/** One-off connectivity test used by the "add server" form (nothing is persisted). */
export async function testConnection(s: ServerSecrets): Promise<TestResult> {
  const client = new Client()
  const started = Date.now()
  try {
    const cfg = buildConnectConfig(s)
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve).once('error', reject)
      client.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([s.password ?? '']))
      client.connect(cfg)
    })
    const out = await run(client, `. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"`, 8000, false)
    return { ok: true, latencyMs: Date.now() - started, os: out.trim() || undefined }
  } catch (e) {
    return { ok: false, error: friendlyError(e) }
  } finally {
    client.end()
  }
}

function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/authentication/i.test(m)) return 'Authentication failed (wrong user, password or key)'
  if (/ENOTFOUND/.test(m)) return 'Host not found (DNS)'
  if (/ECONNREFUSED/.test(m)) return 'Connection refused (SSH port closed?)'
  if (/ETIMEDOUT|Timed out/i.test(m)) return 'Connection timed out'
  return m
}

class Session {
  private client: Client | null = null
  private status: ServerStatus
  private stopped = false
  private timer: NodeJS.Timeout | undefined
  private backoff = 3000
  private prevCpu: CpuSample | null = null
  private prevNet: (NetSample & { at: number }) | null = null
  private lastSlow = 0
  private hostKeyRejected = false

  constructor(
    private readonly id: string,
    private readonly getPoll: () => number,
    private readonly emit: (s: ServerStatus) => void
  ) {
    this.status = emptyStatus(id)
  }

  snapshot(): ServerStatus {
    return { ...this.status, availability: availability(this.id) }
  }

  start(): void {
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.client?.end()
    this.client = null
  }

  private publish(): void {
    this.emit(this.snapshot())
  }

  private setOffline(error: string): void {
    this.status = { ...this.status, state: 'offline', error, checkedAt: Date.now(), netRx: 0, netTx: 0 }
    recordCheck(this.id, false)
    this.publish()
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    const secrets = getSecrets(this.id)
    if (!secrets) return
    const client = new Client()
    this.client = client
    const gen = ++this.gen
    const live = (): boolean => !this.stopped && gen === this.gen && this.client === client
    this.prevCpu = null
    this.prevNet = null
    this.lastSlow = 0
    this.hostKeyRejected = false

    let cfg: ConnectConfig
    try {
      cfg = buildConnectConfig(secrets, (fp) => {
        if (!secrets.hostKey) {
          pinHostKey(this.id, fp) // trust on first use
          return true
        }
        const ok = secrets.hostKey === fp
        if (!ok) this.hostKeyRejected = true
        return ok
      })
    } catch (e) {
      this.setOffline(friendlyError(e))
      return // config error — retrying won't help until the user edits the server
    }

    client.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([secrets.password ?? '']))
    client.on('ready', () => {
      if (!live()) return
      this.backoff = 3000
      void this.tick(gen)
    })
    client.on('error', (e) => {
      if (!live()) return
      const msg = this.hostKeyRejected
        ? 'Host key changed! Possible MITM — remove and re-add the server if this is expected.'
        : friendlyError(e)
      this.handleDrop(msg)
    })
    client.on('close', () => {
      if (live()) this.handleDrop(this.status.error || 'Connection closed')
    })
    client.connect(cfg)
  }

  private gen = 0
  private dropping = false
  private handleDrop(msg: string): void {
    if (this.stopped || this.dropping) return
    this.dropping = true
    if (this.timer) clearTimeout(this.timer)
    try {
      this.client?.end()
    } catch {
      /* already closed */
    }
    this.client = null
    this.setOffline(msg)
    if (this.hostKeyRejected) return // do not hammer a host that failed verification
    this.timer = setTimeout(() => {
      this.dropping = false
      void this.connect()
    }, this.backoff)
    this.backoff = Math.min(this.backoff * 2, 30_000)
  }

  private async tick(gen: number): Promise<void> {
    const client = this.client
    if (this.stopped || !client || gen !== this.gen) return
    const t0 = Date.now()
    try {
      const wasPrimed = this.prevCpu !== null
      await this.fast(client)
      if (!wasPrimed) {
        // First sample only primes the CPU/net counters; take a second one shortly after.
        await new Promise((r) => setTimeout(r, 600))
        if (gen !== this.gen) return
        await this.fast(client)
      }
      if (Date.now() - this.lastSlow > SLOW_EVERY_MS) await this.slow(client)
      if (this.stopped || gen !== this.gen) return // connection was dropped/replaced while probing
      recordCheck(this.id, true)
      this.publish()
    } catch (e) {
      if (gen === this.gen) this.handleDrop(friendlyError(e))
      return
    }
    const wait = Math.max(500, this.getPoll() * 1000 - (Date.now() - t0))
    this.timer = setTimeout(() => void this.tick(gen), wait)
  }

  private async fast(client: Client): Promise<void> {
    const t = Date.now()
    const out = await run(client, FAST_SCRIPT)
    const rtt = Date.now() - t
    const sec = splitSections(out)
    const cpu = parseCpu(sec.CPU ?? [])
    const mem = parseMem(sec.MEM ?? [])
    const net = parseNet(sec.NET ?? [])
    const now = Date.now()

    let cpuNow = this.status.cpu
    if (cpu && this.prevCpu) cpuNow = cpuPct(this.prevCpu, cpu)
    if (cpu) this.prevCpu = cpu

    let rx = 0
    let tx = 0
    if (this.prevNet) {
      const dt = (now - this.prevNet.at) / 1000
      if (dt > 0) {
        rx = Math.max(0, (net.rx - this.prevNet.rx) / dt)
        tx = Math.max(0, (net.tx - this.prevNet.tx) / dt)
      }
    }
    this.prevNet = { ...net, at: now }

    const load = (sec.LOAD?.[0] ?? '').trim().split(/\s+/).slice(0, 3).map(Number)
    const up = Number((sec.UP?.[0] ?? '').split(/\s+/)[0]) || 0

    const push = (h: number[], v: number): number[] => [...h, v].slice(-HISTORY)
    this.status = {
      ...this.status,
      state: 'online',
      error: undefined,
      checkedAt: now,
      latencyMs: rtt,
      cpu: cpuNow,
      load: [load[0] || 0, load[1] || 0, load[2] || 0],
      memTotal: mem.total,
      memUsed: mem.used,
      memPct: mem.pct,
      swapTotal: mem.swapTotal,
      swapUsed: mem.swapUsed,
      netRx: rx,
      netTx: tx,
      uptimeSec: up,
      cpuHistory: push(this.status.cpuHistory, cpuNow),
      memHistory: push(this.status.memHistory, mem.pct)
    }
  }

  private async slow(client: Client): Promise<void> {
    const out = await run(client, SLOW_SCRIPT, 30_000)
    const sec = splitSections(out)
    const [os = '', kernel = '', hostname = ''] = (sec.OS ?? []).map((l) => l.trim())
    this.lastSlow = Date.now()
    this.status = {
      ...this.status,
      os,
      kernel,
      hostname,
      cores: Number((sec.CORES?.[0] ?? '').trim()) || this.status.cores,
      disks: parseDisks(sec.DISK ?? []),
      docker: parseDocker(sec.DOCKER ?? []),
      pm2: parsePm2(sec.PM2 ?? []),
      services: parseServices(sec.SVC ?? []),
      ports: parsePorts(sec.PORTS ?? [])
    }
  }
}

export class Monitor extends EventEmitter {
  private sessions = new Map<string, Session>()
  constructor(private getPoll: () => number) {
    super()
  }

  add(id: string): void {
    this.remove(id)
    const s = new Session(id, this.getPoll, (st) => this.emit('status', st))
    this.sessions.set(id, s)
    s.start()
  }

  remove(id: string): void {
    this.sessions.get(id)?.stop()
    this.sessions.delete(id)
  }

  snapshot(): Record<string, ServerStatus> {
    const out: Record<string, ServerStatus> = {}
    for (const [id, s] of this.sessions) out[id] = s.snapshot()
    return out
  }

  stopAll(): void {
    for (const s of this.sessions.values()) s.stop()
    this.sessions.clear()
  }
}
