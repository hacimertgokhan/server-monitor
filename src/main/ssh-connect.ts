import { Client } from 'ssh2'
import type { ConnectConfig } from 'ssh2'
import { readFileSync } from 'fs'
import type { ServerSecrets } from './store'
import { getSecrets, pinHostKey } from './store'

export function buildConnectConfig(s: ServerSecrets, onHostKey?: (fp: string) => boolean): ConnectConfig {
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

export function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/authentication/i.test(m)) return 'Authentication failed (wrong user, password or key)'
  if (/ENOTFOUND/.test(m)) return 'Host not found (DNS)'
  if (/ECONNREFUSED/.test(m)) return 'Connection refused (SSH port closed?)'
  if (/ETIMEDOUT|Timed out/i.test(m)) return 'Connection timed out'
  return m
}

/**
 * Opens a dedicated SSH connection to a saved server (used by terminals and the file manager, so they never share
 * a channel with the monitoring probes). The pinned host key is enforced exactly like for monitoring.
 */
export function connectServer(id: string): Promise<Client> {
  const secrets = getSecrets(id)
  if (!secrets) return Promise.reject(new Error('Unknown item'))
  return new Promise<Client>((resolve, reject) => {
    const client = new Client()
    let keyRejected = false
    let cfg: ConnectConfig
    try {
      cfg = buildConnectConfig(secrets, (fp) => {
        if (!secrets.hostKey) {
          pinHostKey(id, fp) // trust on first use
          return true
        }
        const ok = secrets.hostKey === fp
        if (!ok) keyRejected = true
        return ok
      })
    } catch (e) {
      return reject(new Error(friendlyError(e)))
    }
    client.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([secrets.password ?? '']))
    client.once('ready', () => resolve(client))
    client.once('error', (e) => {
      client.end()
      reject(
        new Error(keyRejected ? 'Host key changed! Possible MITM — remove and re-add the server if this is expected.' : friendlyError(e))
      )
    })
    client.connect(cfg)
  })
}
