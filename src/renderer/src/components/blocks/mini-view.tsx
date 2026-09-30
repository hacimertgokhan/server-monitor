import { Maximize2, MonitorPlay } from 'lucide-react'
import type { AppMode, ServerInfo, ServerStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { formatUptime } from '@/lib/utils'
import { Bar } from './motion'
import { StateDot, diskSummary } from './server-node'

interface Props {
  servers: ServerInfo[]
  statuses: Record<string, ServerStatus>
  summary: { total: number; online: number }
  onMode: (m: AppMode) => void
  onSelect: (id: string) => void
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <Bar value={value} />
      <span className="w-8 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{value.toFixed(0)}%</span>
    </div>
  )
}

/** Compact always-on-top list: one row per server with three live meters. */
export function MiniView({ servers, statuses, summary, onMode, onSelect }: Props) {
  const t = useT()
  return (
    <div className="flex h-full flex-col bg-background">
      <header
        className="drag flex h-8 shrink-0 items-center justify-between pl-3"
        style={{ paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw) + 4px)' }}
      >
        <span className="text-[11px] text-muted-foreground">
          <span className="text-ok">{summary.online}</span>/{summary.total} {t('online')}
        </span>
        <div className="flex">
          <Button variant="ghost" size="icon" className="size-6" title={t('Wallpaper mode')} onClick={() => onMode('wallpaper')}>
            <MonitorPlay className="!size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-6" title={t('Window mode')} onClick={() => onMode('window')}>
            <Maximize2 className="!size-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-auto px-3 pb-3">
        {servers.length === 0 && (
          <p className="py-10 text-center text-xs text-muted-foreground">{t('No servers. Add one from window mode.')}</p>
        )}
        {servers.map((s) => {
          const st = statuses[s.id]
          const off = st?.state === 'offline'
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className="no-drag block w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-dim"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                  <StateDot status={st} />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-dim">{off ? t('offline') : formatUptime(st?.uptimeSec ?? 0)}</span>
              </div>
              {off ? (
                <div className="text-[11px] text-bad/80">{st?.error ? t(st.error) : ''}</div>
              ) : (
                <div className="space-y-1">
                  <Meter label="CPU" value={st?.cpu ?? 0} />
                  <Meter label="RAM" value={st?.memPct ?? 0} />
                  <Meter label={t('Disk')} value={diskSummary(st).pct} />
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
