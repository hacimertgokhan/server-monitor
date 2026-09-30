import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Box, Check, Cog, Container, Copy, Download, RefreshCw, Search, WrapText } from 'lucide-react'
import type { Api, LogKind, LogResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { demoLogs } from '@/lib/demo'
import { useI18n } from '@/lib/i18n'
import { countMatches, filterLines, formatBytesShort, parseLogs, splitMatches } from '@/lib/logs'
import type { LogLevel } from '@/lib/logs'
import { cn } from '@/lib/utils'

export interface LogTarget {
  serverId: string
  serverName: string
  kind: LogKind
  name: string
}

interface Props {
  target: LogTarget | null
  onClose: () => void
  api?: Api
}

const LINE_OPTIONS = [100, 200, 500, 1000, 2000]
const LIVE_MS = 3000

const LEVEL_TEXT: Record<LogLevel, string> = {
  error: 'text-bad',
  warn: 'text-warn',
  info: 'text-foreground',
  debug: 'text-subtle',
  plain: 'text-foreground/90',
  meta: 'text-info'
}
const LEVEL_BAR: Record<LogLevel, string> = {
  error: 'border-l-bad',
  warn: 'border-l-warn',
  info: 'border-l-transparent',
  debug: 'border-l-transparent',
  plain: 'border-l-transparent',
  meta: 'border-l-info'
}

const KIND_ICON = { docker: Container, pm2: Box, service: Cog } as const

/** "2026-09-30T09:12:33.123Z" -> "09:12:33"; the full stamp stays available as a tooltip. */
const shortTs = (ts: string): string => /(\d{2}:\d{2}:\d{2})/.exec(ts)?.[1] ?? ts

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'no-drag inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
        on ? 'border-foreground/40 bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

export function LogViewer({ target, onClose, api }: Props) {
  const { t, locale } = useI18n()
  const [lines, setLines] = useState(200)
  const [live, setLive] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [follow, setFollow] = useState(true)
  const [query, setQuery] = useState('')
  const [onlyMatches, setOnlyMatches] = useState(false)
  const [levels, setLevels] = useState<LogLevel[]>([])
  const [result, setResult] = useState<LogResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const inflight = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)

  const key = target ? `${target.serverId}/${target.kind}/${target.name}` : ''

  // a new target starts from a clean slate
  useEffect(() => {
    setResult(null)
    setQuery('')
    setLevels([])
    setLive(false)
    setFollow(true)
  }, [key])

  const load = useCallback(async () => {
    if (!target || inflight.current) return
    inflight.current = true
    setLoading(true)
    try {
      const r = api
        ? await api.fetchLogs({ serverId: target.serverId, kind: target.kind, name: target.name, lines })
        : { ok: true, text: demoLogs(target.kind, target.name, lines), at: Date.now() }
      setResult(r)
    } finally {
      inflight.current = false
      setLoading(false)
    }
  }, [api, target, lines])

  useEffect(() => {
    void load()
  }, [load, key])

  useEffect(() => {
    if (!live || !target) return
    const timer = setInterval(() => void load(), LIVE_MS)
    return () => clearInterval(timer)
  }, [live, target, load])

  const parsed = useMemo(() => (result?.ok ? parseLogs(result.text) : []), [result])
  const shown = useMemo(() => filterLines(parsed, { query, onlyMatches, levels }), [parsed, query, onlyMatches, levels])
  const errorCount = useMemo(() => parsed.filter((l) => l.level === 'error').length, [parsed])
  const warnCount = useMemo(() => parsed.filter((l) => l.level === 'warn').length, [parsed])
  const matchCount = useMemo(() => countMatches(shown, query), [shown, query])

  // keep the newest line in view while following
  useEffect(() => {
    if (!follow) return
    // after paint, so the dialog's own layout (grid rows, animation) has settled
    const id = requestAnimationFrame(() => {
      const el = scroller.current
      if (el) el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [shown, follow, wrap, result])

  const toggleLevel = (l: LogLevel): void => setLevels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]))

  const visibleText = (): string => shown.map((l) => (l.ts ? `${l.ts} ${l.text}` : l.text)).join('\n')

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(visibleText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const save = (): void => {
    if (!target) return
    const url = URL.createObjectURL(new Blob([visibleText() + '\n'], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${target.serverName}-${target.name}.log`.replace(/[^\w.-]+/g, '_')
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const Icon = target ? KIND_ICON[target.kind] : Container
  const title = target?.kind === 'docker' ? t('Container logs') : target?.kind === 'pm2' ? t('PM2 logs') : t('Service logs (journal)')

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="h-[86vh] max-w-6xl grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3" aria-describedby={undefined}>
        {target && (
          <>
            <div className="flex items-start gap-3 pr-8">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                <Icon className="size-4.5" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate font-mono text-base">{target.name}</DialogTitle>
                <DialogDescription className="truncate text-xs">
                  {title} · {target.serverName}
                </DialogDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Search in logs…')}
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Toggle on={onlyMatches} onClick={() => setOnlyMatches((v) => !v)} title={t('Show only matching lines')}>
                {t('Only matches')}
                {query.trim() && <span className="font-mono text-subtle">{matchCount}</span>}
              </Toggle>
              <Toggle on={levels.includes('error')} onClick={() => toggleLevel('error')} title={t('Errors')}>
                <span className="size-2 rounded-full bg-bad" />
                {t('Errors')} <span className="font-mono text-subtle">{errorCount}</span>
              </Toggle>
              <Toggle on={levels.includes('warn')} onClick={() => toggleLevel('warn')} title={t('Warnings')}>
                <span className="size-2 rounded-full bg-warn" />
                {t('Warnings')} <span className="font-mono text-subtle">{warnCount}</span>
              </Toggle>
              <select
                aria-label={t('Lines')}
                value={lines}
                onChange={(e) => setLines(Number(e.target.value))}
                className="no-drag h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              >
                {LINE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {t('{n} lines', { n })}
                  </option>
                ))}
              </select>
              <label className="no-drag flex h-8 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-muted-foreground">
                <span className={cn('size-2 rounded-full', live ? 'dot-live bg-ok' : 'bg-dim')} />
                {t('Live')}
                <Switch checked={live} onCheckedChange={setLive} />
              </label>
              <Toggle on={wrap} onClick={() => setWrap((v) => !v)} title={t('Wrap long lines')}>
                <WrapText className="size-3.5" />
              </Toggle>
              <Toggle on={follow} onClick={() => setFollow((v) => !v)} title={t('Follow newest line')}>
                <ArrowDownToLine className="size-3.5" />
              </Toggle>
              <Button variant="outline" size="icon" title={t('Refresh')} aria-label={t('Refresh')} onClick={() => void load()}>
                <RefreshCw className={cn(loading && 'animate-spin')} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title={t('Copy')}
                aria-label={t('Copy')}
                onClick={() => void copy()}
                disabled={!shown.length}
              >
                {copied ? <Check className="text-ok" /> : <Copy />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                title={t('Save as file')}
                aria-label={t('Save as file')}
                onClick={save}
                disabled={!shown.length}
              >
                <Download />
              </Button>
            </div>

            <div
              ref={scroller}
              data-testid="log-body"
              onScroll={(e) => {
                const el = e.currentTarget
                const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40
                if (near !== follow) setFollow(near)
              }}
              className="min-h-0 select-text overflow-auto rounded-lg border border-border bg-background py-2"
            >
              {!result ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('Loading…')}</p>
              ) : !result.ok ? (
                <p className="px-4 py-10 text-center text-sm text-bad">{result.error ? t(result.error) : t('Could not read the logs')}</p>
              ) : shown.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {parsed.length ? t('No lines match the filter') : t('No log output.')}
                </p>
              ) : (
                <div className={cn('font-mono text-[12.5px] leading-5', !wrap && 'w-max min-w-full')}>
                  {shown.map((l) => (
                    <div key={l.n} className={cn('flex gap-3 border-l-2 px-3 hover:bg-secondary/40', LEVEL_BAR[l.level])}>
                      <span className="w-10 shrink-0 select-none text-right text-subtle/70">{l.n}</span>
                      {l.ts && (
                        <span className="shrink-0 text-subtle" title={l.ts}>
                          {shortTs(l.ts)}
                        </span>
                      )}
                      <span className={cn(wrap ? 'min-w-0 whitespace-pre-wrap break-all' : 'whitespace-pre', LEVEL_TEXT[l.level])}>
                        {splitMatches(l.text, query).map((p, i) =>
                          p.hit ? (
                            <mark key={i} className="rounded-sm bg-caution/30 text-foreground">
                              {p.s}
                            </mark>
                          ) : (
                            <span key={i}>{p.s}</span>
                          )
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-subtle">
              <span>
                {t('{n} lines', { n: shown.length })}
                {shown.length !== parsed.length && <span> / {parsed.length}</span>}
                {result?.ok && <span> · {formatBytesShort(new Blob([result.text]).size)}</span>}
              </span>
              <span>{result ? t('updated {t}', { t: new Date(result.at).toLocaleTimeString(locale) }) : ''}</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
