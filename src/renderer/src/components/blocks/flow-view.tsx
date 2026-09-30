import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, useStore } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { LayoutMode, ServerInfo, ServerStatus } from '@shared/types'
import { autoLayout, clampScale, radialLayout } from '@/lib/layout'
import type { Point } from '@/lib/layout'
import { HubNode } from './hub-node'
import type { HubData } from './hub-node'
import { PulseEdge } from './pulse-edge'
import { ServerNode } from './server-node'

const nodeTypes = { server: ServerNode, hub: HubNode }
const edgeTypes = { pulse: PulseEdge }

export interface FlowViewProps {
  servers: ServerInfo[]
  statuses: Record<string, ServerStatus>
  hub: HubData
  interactive: boolean
  layout: LayoutMode
  cardScale: number
  cardScales: Record<string, number>
  positions: Record<string, Point>
  /** Bumped by "reset layout" / "fit" buttons. */
  resetKey: number
  fitKey: number
  onSelect?: (id: string) => void
  /** Dragging a card (in any layout) switches to free placement and stores all positions. */
  onFreePlacement?: (positions: Record<string, Point>) => void
  onCardScale?: (id: string, scale: number) => void
}

/** Re-fits when the server set / layout changes; in wallpaper mode also when the container or card sizes change. */
function AutoFit({ trigger, followSize }: { trigger: string; followSize: boolean }) {
  const { fitView } = useReactFlow()
  const size = useStore((s) => (followSize ? `${Math.round(s.width)}x${Math.round(s.height)}` : ''))
  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.14, duration: 700 }), 200)
    return () => clearTimeout(t)
  }, [trigger, size, fitView])
  return null
}

function Flow(props: FlowViewProps) {
  const {
    servers,
    statuses,
    hub,
    interactive,
    layout,
    cardScale,
    cardScales,
    positions,
    resetKey,
    fitKey,
    onSelect,
    onFreePlacement,
    onCardScale
  } = props
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const { getNodes } = useReactFlow()
  // Scales being dragged right now (committed to settings on release, so we don't write on every pointer move).
  const [live, setLive] = useState<Record<string, number>>({})
  const seeded = useRef({ layout: '' as string, resetKey })
  // Bumps only when an *automatic* layout is entered, so switching to free placement never moves the camera.
  const [autoEntered, setAutoEntered] = useState(0)
  useEffect(() => {
    if (layout !== 'free') setAutoEntered((n) => n + 1)
  }, [layout])

  const scaleOf = useCallback(
    (id: string): number => clampScale(cardScale * (live[id] ?? cardScales[id] ?? 1)),
    [cardScale, cardScales, live]
  )
  const scales = servers.map((s) => scaleOf(s.id))
  const scaleSig = scales.map((s) => s.toFixed(2)).join(',')

  const handleScale = useCallback(
    (id: string, perCard: number, commit: boolean) => {
      if (commit) {
        setLive((l) => {
          const { [id]: _drop, ...rest } = l
          return rest
        })
        onCardScale?.(id, perCard)
      } else {
        setLive((l) => ({ ...l, [id]: perCard }))
      }
    },
    [onCardScale]
  )

  useEffect(() => {
    // Re-seed positions when the layout mode changed or the user pressed "reset layout"; otherwise free mode keeps
    // whatever the nodes currently have (so dragging is never overwritten by data refreshes).
    const prevLayout = seeded.current.layout
    const enteringFree = layout === 'free' && prevLayout !== '' && prevLayout !== 'free'
    const reseed = (prevLayout !== layout && !enteringFree) || seeded.current.resetKey !== resetKey
    seeded.current = { layout, resetKey }
    if (enteringFree)
      setTimeout(
        () =>
          onFreePlacement?.(
            Object.fromEntries(getNodes().map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]))
          ),
        50
      )
    const radial = radialLayout(scales)
    const auto = layout === 'free' ? null : autoLayout(layout, scales)

    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]))
      const place = (id: string, fallback: Point, saved?: Point): Point => {
        const ex = old.get(id)
        if (auto) return ex?.dragging ? ex.position : fallback
        if (reseed || !ex) return saved ?? fallback
        return ex.position
      }
      const hubNode: Node = {
        ...(old.get('hub') ?? {}),
        id: 'hub',
        type: 'hub',
        position: place('hub', auto?.hub ?? { x: 0, y: 0 }, positions.hub),
        data: hub,
        draggable: interactive,
        selectable: false
      }
      const list = servers.map((s, i): Node => ({
        ...(old.get(s.id) ?? {}),
        id: s.id,
        type: 'server',
        position: place(s.id, (auto ?? radial).cards[i], positions[s.id]),
        data: { info: s, status: statuses[s.id], scale: scales[i], interactive, onScale: handleScale, base: cardScale },
        draggable: interactive
      }))
      return [hubNode, ...list]
    })
    // positions/scales are read through refs of the current render; scaleSig captures scale changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, statuses, hub, interactive, layout, resetKey, scaleSig, cardScale, setNodes, handleScale])

  const edges = useMemo<Edge[]>(
    () =>
      servers.map((s) => {
        const st = statuses[s.id]
        return {
          id: `e-${s.id}`,
          source: 'hub',
          target: s.id,
          type: 'pulse',
          selectable: false,
          data: { state: st?.state ?? 'connecting', latency: st?.latencyMs ?? 0, load: Math.max(st?.cpu ?? 0, st?.memPct ?? 0) }
        }
      }),
    [servers, statuses]
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      nodeOrigin={[0.5, 0.5]}
      fitView
      fitViewOptions={{ padding: 0.14 }}
      minZoom={0.1}
      maxZoom={1.8}
      nodesDraggable={interactive}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={interactive}
      zoomOnScroll={interactive}
      zoomOnDoubleClick={false}
      zoomOnPinch={interactive}
      preventScrolling={interactive}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
      onNodeClick={(_, n) => n.type === 'server' && interactive && onSelect?.(n.id)}
      onNodeDragStop={() => {
        onFreePlacement?.(Object.fromEntries(getNodes().map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }])))
      }}
    >
      <Background variant={BackgroundVariant.Dots} gap={30} size={1.2} color="#272727" />
      <AutoFit trigger={`${servers.length}:${resetKey}:${fitKey}:${autoEntered}${interactive ? '' : scaleSig}`} followSize={!interactive} />
    </ReactFlow>
  )
}

export function FlowView(props: FlowViewProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  )
}
