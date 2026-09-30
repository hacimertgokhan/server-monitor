import { memo, useRef } from 'react'
import type { PointerEvent } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { ArrowDown, ArrowUp, Box, Cog, Container, Network, Timer } from 'lucide-react'
import type { ServerInfo, ServerStatus } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/lib/i18n'
import { CARD_W, clampScale } from '@/lib/layout'
import { COLORS, cn, formatBytes, formatDuration, formatRate, formatUptime, pctText } from '@/lib/utils'
import { RingGauge, Sparkline } from './motion'

export interface ServerNodeData extends Record<string, unknown> {
  info: ServerInfo
  status?: ServerStatus
  /** Effective size multiplier (global x per-card). */
  scale: number
  /** Global multiplier, so a per-card value can be derived from a dragged size. */
  base: number
  interactive: boolean
  onScale?: (id: string, perCardScale: number, commit: boolean) => void
}
export type ServerFlowNode = Node<ServerNodeData, 'server'>

export const stateColor = (s?: ServerStatus): string =>
  !s || s.state === 'connecting' ? COLORS.caution : s.state === 'online' ? COLORS.ok : COLORS.bad

/** Worst mounted volume drives the disk gauge. */
export function diskSummary(s?: ServerStatus): { pct: number; sub: string } {
  const d = s?.disks.length ? s.disks.reduce((a, b) => (b.pct > a.pct ? b : a)) : undefined
  return d ? { pct: d.pct, sub: `${d.mount} ${formatBytes(d.used, 0)}/${formatBytes(d.size, 0)}` } : { pct: 0, sub: '–' }
}

export function StateDot({ status, className }: { status?: ServerStatus; className?: string }) {
  const color = stateColor(status)
  return (
    <span
      className={cn('inline-block size-2 rounded-full', status?.state !== 'offline' && 'dot-live', className)}
      style={{ background: color, boxShadow: `0 0 8px ${color}88` }}
    />
  )
}

/** Bottom-right grip: drag to scale the card. Works in flow units, so it is correct at any zoom level. */
function ResizeGrip({
  id,
  scale,
  base,
  onScale
}: {
  id: string
  scale: number
  base: number
  onScale: NonNullable<ServerNodeData['onScale']>
}) {
  const t = useT()
  const { getZoom } = useReactFlow()
  const drag = useRef<{ x: number; scale: number } | null>(null)
  const perCard = (e: PointerEvent<HTMLDivElement>): number => {
    const d = drag.current!
    const dx = (e.clientX - d.x) / getZoom()
    return clampScale((CARD_W * d.scale + dx) / CARD_W) / base
  }
  return (
    <div
      className="nodrag nopan absolute bottom-0 right-0 z-10 flex size-6 cursor-nwse-resize items-end justify-end p-1 opacity-0 transition-opacity group-hover:opacity-100"
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, scale }
      }}
      onPointerMove={(e) => drag.current && onScale(id, perCard(e), false)}
      onPointerUp={(e) => {
        if (!drag.current) return
        onScale(id, perCard(e), true)
        drag.current = null
      }}
      onClick={(e) => e.stopPropagation()}
      title={t('Drag to resize')}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" className="text-dim">
        <path d="M9 1 1 9M9 5 5 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function ServerNodeImpl({ data }: NodeProps<ServerFlowNode>) {
  const t = useT()
  const { info, status: s, scale, base, interactive, onScale } = data
  const online = s?.state === 'online'
  const disk = diskSummary(s)
  const dockerWarn = !!s && s.docker.available && s.docker.running < s.docker.total
  const pm2Bad = !!s && s.pm2.available && s.pm2.online < s.pm2.total
  const svcBad = !!s && s.services.failed.length > 0

  return (
    <div
      // CSS zoom makes the layout box grow with the card, so React Flow re-measures it and edges stay attached.
      style={{ zoom: scale }}
      className={cn(
        'group relative w-[300px] rounded-xl border bg-card p-4 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.9)] transition-colors hover:border-dim',
        s?.state === 'offline' ? 'border-bad/40' : 'border-border'
      )}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Top} />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StateDot status={s} />
            <span className="truncate text-[15px] font-semibold text-foreground">{info.name}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {info.host}
            {s?.os ? <span className="text-dim"> · {s.os}</span> : null}
          </div>
        </div>
        <Badge variant={s?.availability.pct24h == null ? 'muted' : (s.availability.pct24h ?? 100) >= 99.5 ? 'ok' : 'warn'}>
          {pctText(s?.availability.pct24h)}
        </Badge>
      </div>

      {s?.state === 'offline' ? (
        <div className="my-4 rounded-lg bg-bad/10 px-3 py-4 text-center text-xs text-bad">
          <div className="font-medium">{t('Offline')}</div>
          <div className="mt-1 text-bad/70">{s.error ? t(s.error) : ''}</div>
          {s.availability.downSince && (
            <div className="mt-1 text-bad/70">{t('dropped {t} ago', { t: formatDuration(Date.now() - s.availability.downSince) })}</div>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-start justify-between px-1">
            <RingGauge value={s?.cpu ?? 0} label="CPU" sub={s?.cores ? t('{n} cores', { n: s.cores }) : '…'} dim={!online} />
            <RingGauge
              value={s?.memPct ?? 0}
              label="RAM"
              sub={s?.memTotal ? `${formatBytes(s.memUsed)}/${formatBytes(s.memTotal, 0)}` : '…'}
              dim={!online}
            />
            <RingGauge value={disk.pct} label={t('Disk')} sub={disk.sub} dim={!online} />
          </div>

          <div className="mt-2">
            <Sparkline values={s?.cpuHistory ?? []} />
          </div>

          <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ArrowDown className="size-3" style={{ color: COLORS.ok }} />
              {formatRate(s?.netRx ?? 0)}
            </span>
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="size-3" style={{ color: COLORS.info }} />
              {formatRate(s?.netTx ?? 0)}
            </span>
            <span title={t('Load average (1 min)')}>load {s?.load[0].toFixed(2) ?? '–'}</span>
            <span>{s?.latencyMs ? `${s.latencyMs} ms` : ''}</span>
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
        <Badge variant="muted" title={t('Server uptime')}>
          <Timer className="size-3" />
          {formatUptime(s?.uptimeSec ?? 0)}
        </Badge>
        <Badge variant={!s?.docker.available ? 'outline' : dockerWarn ? 'warn' : 'ok'} title={t('Docker containers (running/total)')}>
          <Container className="size-3" />
          {s?.docker.available ? `${s.docker.running}/${s.docker.total}` : '–'}
        </Badge>
        <Badge variant={!s?.pm2.available ? 'outline' : pm2Bad ? 'bad' : 'ok'} title={t('PM2 processes (online/total)')}>
          <Box className="size-3" />
          PM2 {s?.pm2.available && s.pm2.daemon ? `${s.pm2.online}/${s.pm2.total}` : '–'}
        </Badge>
        <Badge variant={!s?.services.available ? 'outline' : svcBad ? 'bad' : 'ok'} title={t('systemd services')}>
          <Cog className="size-3" />
          {s?.services.available ? (svcBad ? t('{n} failed', { n: s.services.failed.length }) : s.services.running.length) : '–'}
        </Badge>
        <Badge variant="info" title={t('Listening ports')}>
          <Network className="size-3" />
          {s?.ports.length ?? 0}
        </Badge>
      </div>

      {interactive && onScale && <ResizeGrip id={info.id} scale={scale} base={base} onScale={onScale} />}
    </div>
  )
}

export const ServerNode = memo(ServerNodeImpl)
