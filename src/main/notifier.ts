import type { Issue, IssueKind } from '@shared/issues'

/** How long a problem must persist before we bother the user (avoids flapping alerts). */
export const PERSIST_MS: Record<IssueKind, number> = {
  offline: 15_000,
  cpu: 60_000,
  ram: 60_000,
  disk: 60_000,
  docker: 15_000,
  pm2: 15_000,
  service: 15_000
}
/** The same problem is not announced again within this window (it must have cleared and come back). */
export const RENOTIFY_MS = 5 * 60_000

interface Tracked {
  since: number
  notified: boolean
  /** Seen at first contact, or inside the re-notify window: never announced. */
  muted: boolean
}

export interface TrackerResult {
  /** Problems to announce now. */
  fire: Issue[]
  /** Servers that were announced as offline and are reachable again. */
  recovered: Issue[]
}

/**
 * Turns a stream of per-server issue lists into notifications: only *new* problems (whatever is already wrong when
 * the app starts is not announced), only after they persisted a while, never twice in a row.
 */
export class IssueTracker {
  private active = new Map<string, Map<string, Tracked>>()
  private lastFired = new Map<string, number>()

  update(serverId: string, issues: Issue[], now: number = Date.now()): TrackerResult {
    const first = !this.active.has(serverId)
    const cur = this.active.get(serverId) ?? new Map<string, Tracked>()
    this.active.set(serverId, cur)

    const result: TrackerResult = { fire: [], recovered: [] }
    const ids = new Set(issues.map((i) => i.id))

    for (const [id, t] of cur) {
      if (ids.has(id)) continue
      cur.delete(id)
      if (t.notified && id.endsWith(':offline')) result.recovered.push({ id, serverId, kind: 'offline', severity: 'warn' })
    }

    for (const issue of issues) {
      let t = cur.get(issue.id)
      if (!t) {
        t = { since: now, notified: false, muted: first }
        cur.set(issue.id, t)
      }
      if (t.notified || t.muted || now - t.since < PERSIST_MS[issue.kind]) continue
      const last = this.lastFired.get(issue.id)
      if (last !== undefined && now - last < RENOTIFY_MS) {
        t.muted = true
        continue
      }
      t.notified = true
      this.lastFired.set(issue.id, now)
      result.fire.push(issue)
    }
    return result
  }

  forget(serverId: string): void {
    this.active.delete(serverId)
    for (const id of [...this.lastFired.keys()]) if (id.startsWith(`${serverId}:`)) this.lastFired.delete(id)
  }
}
