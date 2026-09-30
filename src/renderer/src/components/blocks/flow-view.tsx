import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, useStore } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ExpandMode, ExpandedGroups, GroupKey, LayoutMode, LogKind, ServerInfo, ServerStatus } from '@shared/types'
import { autoLayout, clampScale, dirFor, radialLayout, treeOffsets } from '@/lib/layout'
import type { ClusterInput, Point } from '@/lib/layout'
import { GROUP_KEYS, buildGroup } from '@/lib/tree'
import type { BuiltGroup } from '@/lib/tree'
import { HubNode } from './hub-node'
import type { HubData } from './hub-node'
import { PulseEdge } from './pulse-edge'
import { ServerNode } from './server-node'
import { BranchEdge, TreeGroupNode, TreeLeafNode } from './tree-nodes'

const nodeTypes = { server: ServerNode, hub: HubNode, treegroup: TreeGroupNode, treeleaf: TreeLeafNode }
const edgeTypes = { pulse: PulseEdge, branch: BranchEdge }

const groupId = (server: string, g: GroupKey): string => `${server}::${g}`
const leafId = (server: string, g: GroupKey, leaf: string): string => `${server}::${g}::${leaf}`

export interface FlowViewProps {
  servers: ServerInfo[]
  statuses: Record<string, ServerStatus>
  hub: HubData
  interactive: boolean
  layout: LayoutMode
  cardScale: number
  cardScales: Record<string, number>
  positions: Record<string, Point>
  expanded: Record<string, ExpandedGroups>
  /** Bumped by "reset layout" / "fit" buttons. */
  resetKey: number
  fitKey: number
  onSelect?: (id: string) => void
  /** Dragging a card (in any layout) switches to free placement and stores all positions. */
  onFreePlacement?: (positions: Record<string, Point>) => void
  onCardScale?: (id: string, scale: number) => void
  onToggleGroup?: (id: string, group: GroupKey) => void
  onGroupMode?: (id: string, group: GroupKey, mode: ExpandMode) => void
  onOpenLogs?: (serverId: string, kind: LogKind, name: string) => void
}

/** Re-fits when the server set / layout / open sub-trees change; in wallpaper mode also when the container or sizes change. */
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
    expanded,
    resetKey,
    fitKey,
    onSelect,
    onFreePlacement,
    onCardScale,
    onToggleGroup,
    onGroupMode,
    onOpenLogs
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
  const expandedSig = useMemo(() => JSON.stringify(expanded), [expanded])

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

  /** Sub-tree content per server (only groups that are open and have data). */
  const built = useMemo<BuiltGroup[][]>(
    () =>
      servers.map((s) =>
        GROUP_KEYS.flatMap((k) => {
          const mode = expanded[s.id]?.[k]
          const b = mode ? buildGroup(k, statuses[s.id], mode) : null
          return b ? [b] : []
        })
      ),
    [servers, statuses, expanded]
  )

  const branchEdges = useMemo<Edge[]>(
    () =>
      servers.flatMap((s, i) =>
        built[i].flatMap((g) => [
          {
            id: `b-${s.id}-${g.key}`,
            source: s.id,
            target: groupId(s.id, g.key),
            type: 'branch',
            selectable: false,
            data: { tone: g.tone }
          },
          ...g.leaves.map((l) => ({
            id: `b-${s.id}-${g.key}-${l.id}`,
            source: groupId(s.id, g.key),
            target: leafId(s.id, g.key, l.id),
            type: 'branch',
            selectable: false,
            data: { tone: l.tone }
          }))
        ])
      ),
    [servers, built]
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
            Object.fromEntries(
              getNodes()
                .filter((n) => n.type === 'server' || n.type === 'hub')
                .map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }])
            )
          ),
        50
      )

    const inputs: ClusterInput[] = servers.map((_, i) => ({
      scale: scales[i],
      groups: built[i].map((g) => ({ key: g.key, leaves: g.leaves.length }))
    }))
    const radial = radialLayout(inputs)
    const auto = layout === 'free' ? null : autoLayout(layout, inputs)

    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]))
      const place = (id: string, fallback: Point, saved?: Point): Point => {
        const ex = old.get(id)
        if (auto) return ex?.dragging ? ex.position : fallback
        if (reseed || !ex) return saved ?? fallback
        return ex.position
      }
      const hubPos = place('hub', auto?.hub ?? { x: 0, y: 0 }, positions.hub)
      const hubNode: Node = {
        ...(old.get('hub') ?? {}),
        id: 'hub',
        type: 'hub',
        position: hubPos,
        data: hub,
        draggable: interactive,
        selectable: false
      }

      const serverNodes: Node[] = []
      const treeNodes: Node[] = []
      servers.forEach((s, i) => {
        const pos = place(s.id, (auto ?? radial).cards[i], positions[s.id])
        serverNodes.push({
          ...(old.get(s.id) ?? {}),
          id: s.id,
          type: 'server',
          position: pos,
          data: {
            info: s,
            status: statuses[s.id],
            scale: scales[i],
            interactive,
            onScale: handleScale,
            base: cardScale,
            expanded: expanded[s.id],
            onToggleGroup: interactive ? onToggleGroup : undefined
          },
          draggable: interactive
        })

        const dir = auto ? auto.dirs[i] : dirFor(pos, hubPos)
        const { items } = treeOffsets(inputs[i], dir)
        for (const it of items) {
          const g = built[i].find((b) => b.key === it.group)
          if (!g) continue
          const common = { position: { x: pos.x + it.dx, y: pos.y + it.dy }, draggable: false, selectable: false, focusable: false }
          if (it.kind === 'group') {
            const id = groupId(s.id, g.key)
            treeNodes.push({
              ...(old.get(id) ?? {}),
              ...common,
              id,
              type: 'treegroup',
              data: {
                serverId: s.id,
                group: g.key,
                built: { label: g.label, summary: g.summary, tone: g.tone },
                scale: scales[i],
                interactive,
                onToggle: onToggleGroup,
                parent: s.id,
                dx: it.dx,
                dy: it.dy
              }
            })
          } else {
            const leaf = g.leaves[it.index]
            const id = leafId(s.id, g.key, leaf.id)
            treeNodes.push({
              ...(old.get(id) ?? {}),
              ...common,
              id,
              type: 'treeleaf',
              data: {
                leaf,
                serverId: s.id,
                group: g.key,
                scale: scales[i],
                interactive,
                onMore: (sid: string, gk: GroupKey) => onGroupMode?.(sid, gk, leaf.hidden ? 'all' : 'few'),
                onOpenLogs,
                parent: s.id,
                dx: it.dx,
                dy: it.dy
              }
            })
          }
        }
      })
      return [hubNode, ...serverNodes, ...treeNodes]
    })
    // positions/scales are read through refs of the current render; scaleSig captures scale changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    servers,
    statuses,
    hub,
    interactive,
    layout,
    resetKey,
    scaleSig,
    cardScale,
    built,
    expanded,
    setNodes,
    handleScale,
    onToggleGroup,
    onGroupMode,
    onOpenLogs
  ])

  const pulseEdges = useMemo<Edge[]>(
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
  const edges = useMemo(() => [...pulseEdges, ...branchEdges], [pulseEdges, branchEdges])

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
      minZoom={0.05}
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
      onNodeDrag={(_, node) => {
        if (node.type !== 'server') return
        // keep the open sub-tree glued to its server while dragging
        setNodes((ns) =>
          ns.map((n) =>
            (n.type === 'treegroup' || n.type === 'treeleaf') && n.data.parent === node.id
              ? { ...n, position: { x: node.position.x + (n.data.dx as number), y: node.position.y + (n.data.dy as number) } }
              : n
          )
        )
      }}
      onNodeDragStop={() => {
        onFreePlacement?.(
          Object.fromEntries(
            getNodes()
              .filter((n) => n.type === 'server' || n.type === 'hub')
              .map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }])
          )
        )
      }}
    >
      <Background variant={BackgroundVariant.Dots} gap={30} size={1.2} color="#272727" />
      <AutoFit
        trigger={`${servers.length}:${resetKey}:${fitKey}:${autoEntered}${interactive ? '' : scaleSig}${layout === 'free' && interactive ? '' : expandedSig}`}
        followSize={!interactive}
      />
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
