import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REMOTE_LIMITS } from '@shared/remote'
import type { TermStateEvent } from '@shared/remote'
import { startTestServer } from './ssh-test-server'
import type { TestServer } from './ssh-test-server'
import { TerminalHub } from './terminal'

let srv: TestServer

beforeAll(async () => {
  srv = await startTestServer()
})
afterAll(async () => {
  await srv.close()
})

/** A hub wired to the test server, collecting everything the UI would receive. */
function harness(connect: () => ReturnType<TestServer['connect']> = () => srv.connect()) {
  const data = new Map<string, string>()
  const states: TermStateEvent[] = []
  const hub = new TerminalHub({
    connect,
    emitData: (id, d) => data.set(id, (data.get(id) ?? '') + d),
    emitState: (e) => states.push(e)
  })
  const waitFor = async (cond: () => boolean, what: string, ms = 4000): Promise<void> => {
    const t0 = Date.now()
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}\nstates=${JSON.stringify(states)}`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  const out = (id: string): string => data.get(id) ?? ''
  const state = (id: string): string | undefined => states.filter((s) => s.id === id).at(-1)?.state
  return { hub, data, states, waitFor, out, state }
}

describe('TerminalHub', () => {
  it('opens a shell, relays input and output, and reports the state transitions', async () => {
    const h = harness()
    expect((await h.hub.open('t-basic', 'srv', 100, 30)).ok).toBe(true)
    await h.waitFor(() => h.state('t-basic') === 'open', 'open')
    expect(h.states.filter((s) => s.id === 't-basic').map((s) => s.state)).toEqual(['connecting', 'open'])
    await h.waitFor(() => h.out('t-basic').includes('ready$'), 'prompt')
    h.hub.input('t-basic', 'hello\r')
    await h.waitFor(() => h.out('t-basic').includes('ok:hello'), 'echo')
    h.hub.close('t-basic')
  })

  it('requests a real xterm-256color PTY with the window size and forwards resizes', async () => {
    const h = harness()
    await h.hub.open('t-pty', 'srv', 123, 45)
    await h.waitFor(() => h.state('t-pty') === 'open', 'open')
    expect(srv.seen.pty).toMatchObject({ term: 'xterm-256color', cols: 123, rows: 45 })
    h.hub.resize('t-pty', 90, 31)
    await h.waitFor(() => srv.seen.windows.some((w) => w.cols === 90 && w.rows === 31), 'window-change')
    h.hub.close('t-pty')
  })

  it('keeps multi-byte characters intact when a chunk boundary splits them', async () => {
    const h = harness()
    await h.hub.open('t-utf8', 'srv', 80, 24)
    await h.waitFor(() => h.out('t-utf8').includes('ready$'), 'prompt')
    h.hub.input('t-utf8', 'split\r')
    await h.waitFor(() => h.out('t-utf8').includes('ğ'), 'ğ')
    expect(h.out('t-utf8')).not.toContain('�')
    h.hub.close('t-utf8')
  })

  it('buffers keystrokes typed while the connection is still being made', async () => {
    const h = harness(async () => {
      await new Promise((r) => setTimeout(r, 150))
      return srv.connect()
    })
    await h.hub.open('t-early', 'srv', 80, 24)
    h.hub.input('t-early', 'early\r') // before the shell exists
    await h.waitFor(() => h.out('t-early').includes('ok:early'), 'early input')
    h.hub.close('t-early')
  })

  it('pauses the remote stream when the UI falls behind and resumes when it catches up', async () => {
    const h = harness()
    await h.hub.open('t-flow', 'srv', 80, 24)
    await h.waitFor(() => h.out('t-flow').includes('ready$'), 'prompt')
    h.hub.input('t-flow', 'flood\r') // 1.5 MB of output, nothing acknowledged
    await new Promise((r) => setTimeout(r, 400))
    const stalled = h.out('t-flow').length
    expect(stalled).toBeGreaterThan(REMOTE_LIMITS.maxUnacked)
    expect(stalled).toBeLessThan(1_000_000) // paused well before the whole flood arrived
    expect(h.out('t-flow')).not.toContain('FLOOD-DONE')
    // The UI renders everything: acknowledging resumes the stream until the end marker shows up.
    let acked = 0
    await h.waitFor(() => {
      const total = h.out('t-flow').length
      if (total > acked) {
        h.hub.ack('t-flow', total - acked)
        acked = total
      }
      return h.out('t-flow').includes('FLOOD-DONE')
    }, 'flood to finish')
    h.hub.close('t-flow')
  })

  it('reports a closed state with the exit code when the shell ends', async () => {
    const h = harness()
    await h.hub.open('t-exit', 'srv', 80, 24)
    await h.waitFor(() => h.out('t-exit').includes('ready$'), 'prompt')
    h.hub.input('t-exit', 'exit\r')
    await h.waitFor(() => h.state('t-exit') === 'closed', 'closed')
    expect(h.states.at(-1)).toMatchObject({ id: 't-exit', state: 'closed', code: 3 })
    expect(h.hub.count).toBe(0)
  })

  it('reports connection failures instead of throwing', async () => {
    const h = harness(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1')))
    await h.hub.open('t-fail', 'srv', 80, 24)
    await h.waitFor(() => h.state('t-fail') === 'closed', 'closed')
    expect(h.states.at(-1)?.error).toBe('Connection refused (SSH port closed?)')
    expect(h.hub.count).toBe(0)
  })

  it('closing a tab ends the SSH connection without a state event', async () => {
    const before = srv.seen.closed
    const h = harness()
    await h.hub.open('t-close', 'srv', 80, 24)
    await h.waitFor(() => h.state('t-close') === 'open', 'open')
    const events = h.states.length
    h.hub.close('t-close')
    await h.waitFor(() => srv.seen.closed > before, 'server to see the disconnect')
    expect(h.states.length).toBe(events)
    expect(h.hub.count).toBe(0)
  })

  it('closeServer ends only that server’s terminals', async () => {
    const h = harness()
    await h.hub.open('t-a', 'one', 80, 24)
    await h.hub.open('t-b', 'two', 80, 24)
    await h.waitFor(() => h.state('t-a') === 'open' && h.state('t-b') === 'open', 'both open')
    h.hub.closeServer('one')
    expect(h.state('t-a')).toBe('closed')
    expect(h.state('t-b')).toBe('open')
    h.hub.closeAll()
    expect(h.hub.count).toBe(0)
  })

  it('rejects invalid ids, duplicates and too many terminals', async () => {
    const h = harness(() => new Promise(() => undefined)) // never connects
    expect((await h.hub.open('bad id!', 'srv', 80, 24)).ok).toBe(false)
    expect((await h.hub.open(42, 'srv', 80, 24)).ok).toBe(false)
    expect((await h.hub.open('dup', 'srv', 80, 24)).ok).toBe(true)
    expect((await h.hub.open('dup', 'srv', 80, 24)).ok).toBe(false)
    for (let i = 0; i < REMOTE_LIMITS.maxTerminals - 1; i++) await h.hub.open(`fill-${i}`, 'srv', 80, 24)
    expect(await h.hub.open('one-too-many', 'srv', 80, 24)).toEqual({ ok: false, error: 'Too many open terminals' })
    h.hub.closeAll()
  })

  it('ignores input for unknown terminals and oversized pastes', async () => {
    const h = harness()
    expect(() => h.hub.input('nope', 'x')).not.toThrow()
    expect(() => h.hub.resize('nope', 1, 1)).not.toThrow()
    expect(() => h.hub.ack('nope', 1)).not.toThrow()
    await h.hub.open('t-big', 'srv', 80, 24)
    await h.waitFor(() => h.out('t-big').includes('ready$'), 'prompt')
    h.hub.input('t-big', 'x'.repeat(2 * 1024 * 1024) + '\r')
    await new Promise((r) => setTimeout(r, 100))
    expect(h.out('t-big')).not.toContain('xxxxxxxx')
    h.hub.close('t-big')
  })
})
