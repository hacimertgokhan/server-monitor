export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'plain' | 'meta'

export interface LogLine {
  /** 1-based position in the fetched output. */
  n: number
  /** Leading timestamp as printed by the tool (docker, journalctl, pm2 --timestamp), if any. */
  ts?: string
  text: string
  level: LogLevel
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
export const stripAnsi = (s: string): string => s.replace(ANSI, '')

/** ISO-8601 / "2026-09-30 12:00:00" / pm2's "2026-09-30-12:00:00" followed by a separator and the message. */
const TS = /^(\d{4}-\d{2}-\d{2}[T -]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?):?\s(.*)$/
/** "Sep 30 12:00:00 host unit[1]: msg" (classic syslog, used by some journalctl setups). */
const SYSLOG_TS = /^([A-Z][a-z]{2}\s+\d{1,2}\s\d{2}:\d{2}:\d{2})\s(.*)$/
/** pm2 prints "/home/u/.pm2/logs/api-error.log last 200 lines:" before each file. */
const PM2_HEADER = /^(\S+\.log) last \d+ lines:$/

const ERROR = /\b(fatal|panic|crit(?:ical)?|emerg|alert|error|err|exception|traceback|segfault|oom|killed|denied|refused|failed|failure)\b/i
const WARN = /\b(warn(?:ing)?|deprecated|timeout|timed out|retry(?:ing)?|unable)\b/i
const DEBUG = /\b(debug|trace|verbose)\b/i
const INFO = /\b(info|notice|started|listening|ready|success)\b/i

export function detectLevel(text: string): LogLevel {
  if (ERROR.test(text)) return 'error'
  if (WARN.test(text)) return 'warn'
  if (DEBUG.test(text)) return 'debug'
  if (INFO.test(text)) return 'info'
  return 'plain'
}

/** Splits raw tool output into structured lines. Handles ANSI colours, CRLF and pm2's per-file headers. */
export function parseLogs(raw: string): LogLine[] {
  const lines = stripAnsi(raw).replace(/\r\n?/g, '\n').split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const out: LogLine[] = []
  let fileIsError = false
  lines.forEach((line, i) => {
    const header = PM2_HEADER.exec(line)
    if (header) {
      fileIsError = /(^|[-_./\\])(err|error)[-_.]/i.test(header[1])
      out.push({ n: i + 1, text: line, level: 'meta' })
      return
    }
    const m = TS.exec(line) ?? SYSLOG_TS.exec(line)
    const text = m ? m[2] : line
    const level = detectLevel(text)
    out.push({ n: i + 1, ts: m?.[1], text, level: level === 'plain' && fileIsError && text.trim() ? 'error' : level })
  })
  return out
}

export interface LogFilter {
  query: string
  /** Show only lines that match `query` (otherwise matches are just highlighted). */
  onlyMatches: boolean
  /** Restrict to these levels; empty = every level. */
  levels: LogLevel[]
}

export function filterLines(lines: LogLine[], f: LogFilter): LogLine[] {
  const q = f.query.trim().toLowerCase()
  return lines.filter((l) => {
    if (f.levels.length && l.level !== 'meta' && !f.levels.includes(l.level)) return false
    if (f.onlyMatches && q && !l.text.toLowerCase().includes(q)) return false
    return true
  })
}

/** Splits `text` around case-insensitive occurrences of `query` for highlighting. */
export function splitMatches(text: string, query: string): { s: string; hit: boolean }[] {
  const q = query.trim()
  if (!q) return [{ s: text, hit: false }]
  const parts: { s: string; hit: boolean }[] = []
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  let i = 0
  for (;;) {
    const j = lower.indexOf(needle, i)
    if (j < 0) break
    if (j > i) parts.push({ s: text.slice(i, j), hit: false })
    parts.push({ s: text.slice(j, j + needle.length), hit: true })
    i = j + needle.length
  }
  if (i < text.length) parts.push({ s: text.slice(i), hit: false })
  return parts
}

export const countMatches = (lines: LogLine[], query: string): number => {
  const q = query.trim().toLowerCase()
  return q ? lines.filter((l) => l.text.toLowerCase().includes(q)).length : 0
}

export function formatBytesShort(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
