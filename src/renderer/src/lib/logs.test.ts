import { describe, expect, it } from 'vitest'
import { countMatches, detectLevel, filterLines, parseLogs, splitMatches, stripAnsi } from './logs'

describe('parseLogs', () => {
  it('extracts docker timestamps and levels', () => {
    const [a, b, c] = parseLogs(
      [
        '2026-09-30T09:12:33.123456789Z GET /health 200 3ms',
        '2026-09-30T09:12:34.000000000Z WARN cache miss, retrying',
        '2026-09-30T09:12:35.000000000Z ERROR connect ECONNREFUSED 10.0.0.5:5432'
      ].join('\n')
    )
    expect(a).toMatchObject({ n: 1, ts: '2026-09-30T09:12:33.123456789Z', text: 'GET /health 200 3ms', level: 'plain' })
    expect(b.level).toBe('warn')
    expect(c.level).toBe('error')
  })

  it('understands journalctl short-iso and syslog timestamps', () => {
    const [a, b] = parseLogs(
      ['2026-09-30T12:03:11+0300 host nginx[812]: started', 'Sep 30 12:03:12 host sshd[9]: Failed password for root'].join('\n')
    )
    expect(a).toMatchObject({ ts: '2026-09-30T12:03:11+0300', level: 'info' })
    expect(b).toMatchObject({ ts: 'Sep 30 12:03:12', level: 'error' })
  })

  it('treats pm2 error-log sections as errors and keeps the headers as meta', () => {
    const lines = parseLogs(
      [
        '/home/u/.pm2/logs/api-out.log last 2 lines:',
        '2026-09-30-12:00:00: listening on 3000',
        '/home/u/.pm2/logs/api-error.log last 2 lines:',
        '2026-09-30-12:00:01: something odd'
      ].join('\n')
    )
    expect(lines.map((l) => l.level)).toEqual(['meta', 'info', 'meta', 'error'])
    expect(lines[1].ts).toBe('2026-09-30-12:00:00')
  })

  it('strips ANSI colours and CRLF, and drops the trailing empty line', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m plain')).toBe('red plain')
    const lines = parseLogs('\u001b[32mok\u001b[39m\r\nnext\r\n')
    expect(lines.map((l) => l.text)).toEqual(['ok', 'next'])
  })

  it('handles empty output', () => {
    expect(parseLogs('')).toEqual([])
  })
})

describe('detectLevel', () => {
  it('ranks error above warn above info', () => {
    expect(detectLevel('fatal: out of memory')).toBe('error')
    expect(detectLevel('deprecated API, retrying')).toBe('warn')
    expect(detectLevel('server started')).toBe('info')
    expect(detectLevel('debug: x=1')).toBe('debug')
    expect(detectLevel('GET / 200')).toBe('plain')
  })
})

describe('filtering and highlighting', () => {
  const lines = parseLogs(['a error one', 'b warn two', 'c plain three', 'd error four'].join('\n'))

  it('filters by level and by query', () => {
    expect(filterLines(lines, { query: '', onlyMatches: false, levels: ['error'] }).map((l) => l.n)).toEqual([1, 4])
    expect(filterLines(lines, { query: 'ONE', onlyMatches: true, levels: [] }).map((l) => l.n)).toEqual([1])
    expect(filterLines(lines, { query: 'one', onlyMatches: false, levels: [] })).toHaveLength(4) // highlight only
    expect(countMatches(lines, 'error')).toBe(2)
    expect(countMatches(lines, '')).toBe(0)
  })

  it('always keeps pm2 file headers visible when filtering by level', () => {
    const l = parseLogs('/x/a-out.log last 1 lines:\nboom error')
    expect(filterLines(l, { query: '', onlyMatches: false, levels: ['error'] })).toHaveLength(2)
  })

  it('splits text around case-insensitive matches', () => {
    expect(splitMatches('Error: error!', 'error')).toEqual([
      { s: 'Error', hit: true },
      { s: ': ', hit: false },
      { s: 'error', hit: true },
      { s: '!', hit: false }
    ])
    expect(splitMatches('abc', '')).toEqual([{ s: 'abc', hit: false }])
    expect(splitMatches('abc', 'x')).toEqual([{ s: 'abc', hit: false }])
  })
})
