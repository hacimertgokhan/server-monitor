import { BaseEdge, EdgeLabelRenderer, getStraightPath } from '@xyflow/react'
import type { Edge, EdgeProps } from '@xyflow/react'
import type { ConnState } from '@shared/types'
import { COLORS } from '@/lib/utils'

export interface PulseData extends Record<string, unknown> {
  state: ConnState
  latency: number
  load: number
}
export type PulseFlowEdge = Edge<PulseData, 'pulse'>

/** Hub → server link: a packet travels out and one comes back; speed follows latency, colour follows health. */
export function PulseEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<PulseFlowEdge>) {
  const [path, lx, ly] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  const state = data?.state ?? 'connecting'
  const color =
    state === 'online'
      ? data!.load >= 90
        ? COLORS.bad
        : data!.load >= 80
          ? COLORS.warn
          : COLORS.ok
      : state === 'offline'
        ? COLORS.bad
        : COLORS.caution
  const dur = Math.max(1.8, Math.min(4.5, (data?.latency ?? 60) / 30 + 1.2))
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeOpacity: state === 'offline' ? 0.45 : 0.28,
          strokeWidth: 1.5,
          strokeDasharray: state === 'online' ? undefined : '5 6'
        }}
      />
      {state === 'online' && (
        <>
          <circle r="3.2" fill={color}>
            <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} />
          </circle>
          <circle r="2.4" fill={color} fillOpacity="0.6">
            <animateMotion
              dur={`${dur}s`}
              repeatCount="indefinite"
              path={path}
              keyPoints="1;0"
              keyTimes="0;1"
              calcMode="linear"
              begin={`${dur / 2}s`}
            />
          </circle>
        </>
      )}
      {state === 'online' && data!.latency > 0 && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {data!.latency} ms
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
