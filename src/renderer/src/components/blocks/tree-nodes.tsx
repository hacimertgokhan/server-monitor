import { memo } from 'react'
import { BaseEdge, Handle, Position } from '@xyflow/react'
import type { Edge, EdgeProps, Node, NodeProps } from '@xyflow/react'
import { Box, ChevronDown, ChevronRight, Cog, Container, FileText, Network } from 'lucide-react'
import type { GroupKey, LogKind } from '@shared/types'
import { useT } from '@/lib/i18n'
import type { BuiltGroup, Leaf, Tone } from '@/lib/tree'
import { COLORS, cn } from '@/lib/utils'

export const TONE: Record<Tone, string> = { ok: COLORS.ok, warn: COLORS.warn, bad: COLORS.bad, info: COLORS.info, muted: COLORS.dim }

const GROUP_ICON: Record<GroupKey, typeof Box> = { docker: Container, pm2: Box, services: Cog, ports: Network }

// ---------------------------------------------------------------- group node (Docker / PM2 / Services / Ports)
export interface TreeGroupData extends Record<string, unknown> {
  serverId: string
  group: GroupKey
  built: Pick<BuiltGroup, 'label' | 'summary' | 'tone'>
  scale: number
  interactive: boolean
  onToggle?: (serverId: string, group: GroupKey) => void
  // free-mode dragging keeps children glued to their server
  parent: string
  dx: number
  dy: number
}
export type TreeGroupFlowNode = Node<TreeGroupData, 'treegroup'>

function TreeGroupNodeImpl({ data }: NodeProps<TreeGroupFlowNode>) {
  const t = useT()
  const { built, group, scale, interactive, onToggle, serverId } = data
  const Icon = GROUP_ICON[group]
  const color = TONE[built.tone]
  const label = group === 'services' ? t('Services') : group === 'ports' ? t('Ports') : built.label
  return (
    <div style={{ zoom: scale }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <button
        type="button"
        disabled={!interactive}
        onClick={(e) => {
          e.stopPropagation()
          onToggle?.(serverId, group)
        }}
        title={interactive ? t('Hide from flowchart') : undefined}
        className={cn(
          'nodrag nopan flex h-[54px] w-[184px] items-center gap-2.5 rounded-xl border bg-card px-3 text-left shadow-[0_6px_24px_-10px_rgba(0,0,0,0.9)] transition-colors',
          interactive ? 'cursor-pointer hover:border-dim' : 'cursor-default'
        )}
        style={{ borderColor: `${color}66` }}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}22`, color }}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold leading-tight text-foreground">{label}</span>
          <span className="block truncate font-mono text-[12px] leading-tight" style={{ color }}>
            {built.summary}
          </span>
        </span>
        {interactive && <ChevronDown className="size-3.5 shrink-0 text-subtle" />}
      </button>
    </div>
  )
}
export const TreeGroupNode = memo(TreeGroupNodeImpl)

// ---------------------------------------------------------------- leaf node (one container / process / service / port)
export interface TreeLeafData extends Record<string, unknown> {
  leaf: Leaf
  serverId: string
  group: GroupKey
  scale: number
  interactive: boolean
  onMore?: (serverId: string, group: GroupKey) => void
  /** Opens the log viewer for docker / pm2 / service leaves. */
  onOpenLogs?: (serverId: string, kind: LogKind, name: string) => void
  parent: string
  dx: number
  dy: number
}
export type TreeLeafFlowNode = Node<TreeLeafData, 'treeleaf'>

function TreeLeafNodeImpl({ data }: NodeProps<TreeLeafFlowNode>) {
  const t = useT()
  const { leaf, scale, interactive, onMore, onOpenLogs, serverId, group } = data
  const logKind: LogKind | null =
    leaf.kind === 'docker' ? 'docker' : leaf.kind === 'pm2' ? 'pm2' : leaf.kind === 'service' ? 'service' : null
  const loggable = interactive && !!onOpenLogs && logKind !== null
  const color = TONE[leaf.tone]

  if (leaf.kind === 'more') {
    return (
      <div style={{ zoom: scale }}>
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
        <button
          type="button"
          disabled={!interactive}
          onClick={(e) => {
            e.stopPropagation()
            onMore?.(serverId, group)
          }}
          className="nodrag nopan flex h-[50px] w-[250px] items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background text-xs text-muted-foreground transition-colors hover:border-dim hover:text-foreground disabled:cursor-default"
        >
          <ChevronRight className={cn('size-3.5', !leaf.hidden && 'rotate-180')} />
          {leaf.hidden ? t('+{n} more', { n: leaf.hidden }) : t('Show fewer')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ zoom: scale }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div
        role={loggable ? 'button' : undefined}
        title={loggable ? t('Open logs') : undefined}
        onClick={
          loggable
            ? (e) => {
                e.stopPropagation()
                onOpenLogs!(serverId, logKind!, leaf.label)
              }
            : undefined
        }
        className={cn(
          'nodrag nopan flex h-[50px] w-[250px] items-center gap-2.5 rounded-lg border border-border bg-card px-3 transition-colors',
          loggable && 'cursor-pointer hover:border-dim'
        )}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}88` }} />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-[14px] font-medium leading-tight text-foreground',
              leaf.kind !== 'pm2' && leaf.kind !== 'docker' && 'font-mono'
            )}
          >
            {leaf.label}
          </span>
          {leaf.sub && (
            <span
              className="block truncate text-[12px] leading-tight"
              style={{ color: leaf.tone === 'bad' || leaf.tone === 'warn' ? color : undefined }}
            >
              <span className={leaf.tone === 'bad' || leaf.tone === 'warn' ? '' : 'text-muted-foreground'}>{leaf.sub}</span>
            </span>
          )}
        </span>
        {loggable && <FileText className="size-4 shrink-0 text-subtle" />}
        {leaf.kind === 'port' && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] uppercase tracking-wider"
            style={{ background: `${color}22`, color }}
          >
            {leaf.tone === 'warn' ? t('public') : t('local')}
          </span>
        )}
      </div>
    </div>
  )
}
export const TreeLeafNode = memo(TreeLeafNodeImpl)

// ---------------------------------------------------------------- branch edge
export interface BranchData extends Record<string, unknown> {
  tone: Tone
}
export type BranchFlowEdge = Edge<BranchData, 'branch'>

/** Horizontal S-curve between two node centres (nodes are opaque, so the line appears to leave their borders). */
export function BranchEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<BranchFlowEdge>) {
  const mid = (sourceX + targetX) / 2
  const path = `M ${sourceX},${sourceY} C ${mid},${sourceY} ${mid},${targetY} ${targetX},${targetY}`
  const tone = data?.tone ?? 'muted'
  return <BaseEdge id={id} path={path} style={{ stroke: TONE[tone], strokeOpacity: tone === 'muted' ? 0.45 : 0.5, strokeWidth: 1.4 }} />
}
