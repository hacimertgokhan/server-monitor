import { describe, expect, it } from 'vitest'
import type { Issue } from '@shared/issues'
import { IssueTracker, PERSIST_MS, RENOTIFY_MS } from './notifier'

const issue = (kind: Issue['kind'], server = 's1'): Issue => ({ id: `${server}:${kind}`, serverId: server, kind, severity: 'bad' })
const SEC = 1000

describe('IssueTracker', () => {
  it('does not announce what is already wrong when the app starts', () => {
    const t = new IssueTracker()
    expect(t.update('s1', [issue('offline')], 0).fire).toEqual([])
    expect(t.update('s1', [issue('offline')], 60 * SEC).fire).toEqual([])
  })

  it('announces a new problem only after it persisted', () => {
    const t = new IssueTracker()
    t.update('s1', [], 0)
    expect(t.update('s1', [issue('service')], 1 * SEC).fire).toEqual([])
    expect(t.update('s1', [issue('service')], PERSIST_MS.service - SEC).fire).toEqual([])
    expect(t.update('s1', [issue('service')], 1 * SEC + PERSIST_MS.service).fire.map((i) => i.id)).toEqual(['s1:service'])
  })

  it('waits longer for load thresholds than for hard failures', () => {
    expect(PERSIST_MS.cpu).toBeGreaterThan(PERSIST_MS.offline)
    const t = new IssueTracker()
    t.update('s1', [], 0)
    t.update('s1', [issue('cpu')], 0)
    expect(t.update('s1', [issue('cpu')], PERSIST_MS.offline + SEC).fire).toEqual([])
    expect(t.update('s1', [issue('cpu')], PERSIST_MS.cpu + SEC).fire).toHaveLength(1)
  })

  it('announces once, not on every poll', () => {
    const t = new IssueTracker()
    t.update('s1', [], 0)
    t.update('s1', [issue('pm2')], 0)
    expect(t.update('s1', [issue('pm2')], 20 * SEC).fire).toHaveLength(1)
    expect(t.update('s1', [issue('pm2')], 30 * SEC).fire).toEqual([])
    expect(t.update('s1', [issue('pm2')], 10 * 60 * SEC).fire).toEqual([])
  })

  it('reports recovery only for offline problems that were announced', () => {
    const t = new IssueTracker()
    t.update('s1', [], 0)
    t.update('s1', [issue('offline')], 0)
    t.update('s1', [issue('offline')], 20 * SEC)
    expect(t.update('s1', [], 30 * SEC).recovered.map((i) => i.kind)).toEqual(['offline'])

    const quiet = new IssueTracker()
    quiet.update('s1', [], 0)
    quiet.update('s1', [issue('offline')], 0)
    expect(quiet.update('s1', [], 5 * SEC).recovered).toEqual([]) // recovered before it was announced
  })

  it('does not repeat a flapping problem within the cool-down', () => {
    const t = new IssueTracker()
    t.update('s1', [], 0)
    t.update('s1', [issue('docker')], 0)
    expect(t.update('s1', [issue('docker')], 20 * SEC).fire).toHaveLength(1)
    t.update('s1', [], 40 * SEC) // cleared
    t.update('s1', [issue('docker')], 60 * SEC) // came back
    expect(t.update('s1', [issue('docker')], 90 * SEC).fire).toEqual([]) // still inside cool-down
    t.update('s1', [], 100 * SEC)
    t.update('s1', [issue('docker')], RENOTIFY_MS + 200 * SEC)
    expect(t.update('s1', [issue('docker')], RENOTIFY_MS + 230 * SEC).fire).toHaveLength(1)
  })

  it('tracks servers independently and can forget one', () => {
    const t = new IssueTracker()
    t.update('a', [], 0)
    t.update('b', [], 0)
    t.update('a', [issue('service', 'a')], 0)
    t.update('b', [issue('service', 'b')], 0)
    const r = t.update('a', [issue('service', 'a')], 30 * SEC)
    expect(r.fire.map((i) => i.serverId)).toEqual(['a'])
    t.forget('a')
    expect(t.update('a', [issue('service', 'a')], 40 * SEC).fire).toEqual([]) // treated as first contact again
  })
})
