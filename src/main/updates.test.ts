import { describe, expect, it } from 'vitest'
import { checkForUpdates, isNewer } from './updates'

describe('isNewer', () => {
  it('compares semantic versions numerically', () => {
    expect(isNewer('0.10.0', '0.9.5')).toBe(true)
    expect(isNewer('v1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.4.0', '0.4.0')).toBe(false)
    expect(isNewer('0.3.9', '0.4.0')).toBe(false)
    expect(isNewer('0.4.1-beta.1', '0.4.0')).toBe(true)
    expect(isNewer('0.4', '0.4.0')).toBe(false)
  })
})

describe('checkForUpdates', () => {
  const reply = (body: unknown, status = 200): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('reports a newer release with its page', async () => {
    const r = await checkForUpdates(
      '0.3.0',
      reply({ tag_name: 'v0.4.0', html_url: 'https://github.com/hacimertgokhan/server-monitor/releases/tag/v0.4.0' })
    )
    expect(r).toMatchObject({ ok: true, latest: '0.4.0', newer: true })
  })

  it('reports up-to-date and failures without throwing', async () => {
    expect(await checkForUpdates('0.4.0', reply({ tag_name: 'v0.4.0' }))).toMatchObject({ ok: true, newer: false })
    expect(await checkForUpdates('0.4.0', reply({}, 404))).toMatchObject({ ok: false })
    const boom = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await checkForUpdates('0.4.0', boom)).toMatchObject({ ok: false, error: 'offline' })
  })
})
