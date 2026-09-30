import {
  Grid3x3,
  LayoutGrid,
  ListTree,
  Maximize,
  MonitorPlay,
  Move,
  Orbit,
  PictureInPicture2,
  Plus,
  RotateCcw,
  Settings2
} from 'lucide-react'
import type { AppMode, LayoutMode } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { MAX_SCALE, MIN_SCALE } from '@/lib/layout'
import { cn, formatRate } from '@/lib/utils'
import { AnimatedNumber } from './motion'

interface Props {
  mode: AppMode
  onMode: (m: AppMode) => void
  layout: LayoutMode
  onLayout: (l: LayoutMode) => void
  cardScale: number
  onCardScale: (v: number) => void
  onAdd: () => void
  onSettings: () => void
  onResetLayout: () => void
  onFit: () => void
  anyExpanded: boolean
  onToggleAll: () => void
  isDemo: boolean
  summary: { total: number; online: number; offline: number; avgCpu: number; rx: number; tx: number }
}

function Segmented<T extends string>({
  value,
  onChange,
  items
}: {
  value: T
  onChange: (v: T) => void
  items: { id: T; label: string; icon: typeof LayoutGrid }[]
}) {
  return (
    <div className="no-drag flex gap-0.5 rounded-md bg-muted p-0.5">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          title={label}
          aria-label={label}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            'no-drag flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors',
            value === id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon className="size-3.5" />
          <span className="hidden 2xl:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}

export function TopBar({
  mode,
  onMode,
  layout,
  onLayout,
  cardScale,
  onCardScale,
  onAdd,
  onSettings,
  onResetLayout,
  onFit,
  anyExpanded,
  onToggleAll,
  isDemo,
  summary
}: Props) {
  const t = useT()
  return (
    <header
      className="drag flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border bg-background pl-4"
      style={{ paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw) + 12px)' }}
    >
      <div className="flex min-w-0 items-center gap-4 text-xs">
        <span className="flex shrink-0 items-center gap-2 font-medium text-foreground">
          <span className="size-2 rounded-full bg-foreground/80" />
          Server Monitor
        </span>
        {isDemo && <span className="rounded bg-caution/15 px-1.5 py-0.5 text-[10px] font-medium text-caution">DEMO</span>}
        <div className="flex items-center gap-3 truncate text-muted-foreground">
          <span className="shrink-0">
            <span className="text-ok">{summary.online}</span>/{summary.total} {t('online')}
          </span>
          {summary.offline > 0 && (
            <span className="hidden shrink-0 text-bad sm:inline">
              {summary.offline} {t('offline')}
            </span>
          )}
          {summary.online > 0 && (
            <>
              <span className="hidden shrink-0 xl:inline">
                {t('Avg CPU')} <AnimatedNumber value={summary.avgCpu} suffix="%" />
              </span>
              <span className="hidden shrink-0 font-mono 2xl:inline">
                ↓ {formatRate(summary.rx)} · ↑ {formatRate(summary.tx)}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Segmented<LayoutMode>
          value={layout}
          onChange={onLayout}
          items={[
            { id: 'radial', label: t('Auto (radial)'), icon: Orbit },
            { id: 'grid', label: t('Grid'), icon: Grid3x3 },
            { id: 'free', label: t('Free placement'), icon: Move }
          ]}
        />
        <label className="no-drag hidden items-center gap-2 px-1 text-muted-foreground lg:flex" title={t('Card size')}>
          <Maximize className="size-3.5" />
          <input
            type="range"
            aria-label={t('Card size')}
            min={MIN_SCALE}
            max={MAX_SCALE - 0.3}
            step={0.05}
            value={cardScale}
            onChange={(e) => onCardScale(Number(e.target.value))}
            className="no-drag h-1 w-20 cursor-pointer"
          />
        </label>
        <Segmented<AppMode>
          value={mode}
          onChange={onMode}
          items={[
            { id: 'window', label: t('Window'), icon: LayoutGrid },
            { id: 'mini', label: t('Mini'), icon: PictureInPicture2 },
            { id: 'wallpaper', label: t('Wallpaper'), icon: MonitorPlay }
          ]}
        />
        <Button
          variant="ghost"
          size="icon"
          title={anyExpanded ? t('Collapse all') : t('Expand all')}
          aria-label={anyExpanded ? t('Collapse all') : t('Expand all')}
          aria-pressed={anyExpanded}
          onClick={onToggleAll}
          className={anyExpanded ? 'text-foreground' : undefined}
        >
          <ListTree />
        </Button>
        <Button variant="ghost" size="icon" title={t('Fit to screen')} aria-label={t('Fit to screen')} onClick={onFit}>
          <Maximize />
        </Button>
        <Button variant="ghost" size="icon" title={t('Reset layout')} aria-label={t('Reset layout')} onClick={onResetLayout}>
          <RotateCcw />
        </Button>
        <Button variant="ghost" size="icon" title={t('Settings')} aria-label={t('Settings')} onClick={onSettings}>
          <Settings2 />
        </Button>
        <Button size="sm" onClick={onAdd}>
          <Plus /> <span className="hidden sm:inline">{t('Add server')}</span>
        </Button>
      </div>
    </header>
  )
}
