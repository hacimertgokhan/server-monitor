import type { GroupKey, LayoutMode } from '@shared/types'

export interface Point {
  x: number
  y: number
}

/** Axis-aligned box, relative to a server card's centre (or absolute when noted). */
export interface Box {
  l: number
  r: number
  t: number
  b: number
}

/** Card width at scale 1 (px, flow units). Heights vary (~230 offline, ~315 online). */
export const CARD_W = 300
export const CARD_H = 330
export const HUB_R = 115

export const MIN_SCALE = 0.6
export const MAX_SCALE = 1.8
export const clampScale = (v: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, v))

// ---------------------------------------------------------------- sub-tree geometry (flow units at scale 1)
export const GROUP_W = 170
export const GROUP_H = 50
export const LEAF_W = 230
export const LEAF_H = 44
const LEAF_GAP = 8
const GROUP_GAP = 16
const COL_GAP_1 = 60 // card -> group column
const COL_GAP_2 = 44 // group column -> leaf column

export interface GroupSpec {
  key: GroupKey
  /** Number of leaf nodes drawn for this group (including a "+N more" leaf). */
  leaves: number
}

/** A server card plus the groups currently expanded under it. */
export interface ClusterInput {
  scale: number
  groups: GroupSpec[]
}

export interface TreeItem {
  kind: 'group' | 'leaf'
  group: GroupKey
  /** Leaf index inside its group (0 for group nodes). */
  index: number
  dx: number
  dy: number
}

export type Dir = 1 | -1

/**
 * Tidy horizontal tree: groups form a column next to the card, each group's leaves form a second column,
 * stacked so nothing overlaps. `dir` mirrors it to the left (-1) or right (1). Offsets are from the card centre;
 * `box` is the bounding box of card + tree.
 */
export function treeOffsets(input: ClusterInput, dir: Dir): { items: TreeItem[]; box: Box } {
  const s = input.scale
  const halfW = (CARD_W * s) / 2
  const halfH = (CARD_H * s) / 2
  const box: Box = { l: -halfW, r: halfW, t: -halfH, b: halfH }
  const items: TreeItem[] = []
  if (input.groups.length === 0) return { items, box }

  const xGroup = dir * (halfW + COL_GAP_1 * s + (GROUP_W * s) / 2)
  const xLeaf = xGroup + dir * ((GROUP_W * s) / 2 + COL_GAP_2 * s + (LEAF_W * s) / 2)
  const leavesHeight = (n: number): number => (n === 0 ? 0 : n * LEAF_H * s + (n - 1) * LEAF_GAP * s)
  const slots = input.groups.map((g) => Math.max(GROUP_H * s, leavesHeight(g.leaves)))
  const total = slots.reduce((a, b) => a + b, 0) + (slots.length - 1) * GROUP_GAP * s

  let y = -total / 2
  input.groups.forEach((g, gi) => {
    const slot = slots[gi]
    items.push({ kind: 'group', group: g.key, index: 0, dx: xGroup, dy: y + slot / 2 })
    const top = y + (slot - leavesHeight(g.leaves)) / 2
    for (let i = 0; i < g.leaves; i++) {
      items.push({ kind: 'leaf', group: g.key, index: i, dx: xLeaf, dy: top + (LEAF_H * s) / 2 + i * (LEAF_H + LEAF_GAP) * s })
    }
    y += slot + GROUP_GAP * s
  })

  const farX = xLeaf + dir * ((LEAF_W * s) / 2)
  box.l = Math.min(box.l, farX)
  box.r = Math.max(box.r, farX)
  box.t = Math.min(box.t, -total / 2)
  box.b = Math.max(box.b, total / 2)
  return { items, box }
}

// ---------------------------------------------------------------- cluster placement
export interface AutoLayout {
  hub: Point
  cards: Point[]
  /** Which side each server's sub-tree grows to. */
  dirs: Dir[]
}

const at = (p: Point, b: Box): Box => ({ l: p.x + b.l, r: p.x + b.r, t: p.y + b.t, b: p.y + b.b })
const hit = (a: Box, b: Box, gap: number): boolean => a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap
const HUB_BOX: Box = { l: -HUB_R, r: HUB_R, t: -HUB_R, b: HUB_R }

/** Free/radial: a server left of the hub grows its tree to the left, otherwise to the right. */
export const dirFor = (server: Point, hub: Point): Dir => (server.x - hub.x < -20 ? -1 : 1)

/** Do any two clusters (or a cluster and the hub) overlap, with a small gutter? */
function collides(boxes: Box[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    if (hit(boxes[i], HUB_BOX, 24)) return true
    for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j], 24)) return true
  }
  return false
}

/** Clusters on an ellipse around the hub at (0,0); the ellipse grows until no cluster touches another. */
export function radialLayout(inputs: ClusterInput[]): AutoLayout {
  const n = inputs.length
  const k = Math.max(1, ...inputs.map((i) => i.scale))
  const place = (f: number): { cards: Point[]; dirs: Dir[]; boxes: Box[] } => {
    const cards = inputs.map((_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1) + (n === 2 ? Math.PI / 2 : 0)
      return { x: Math.round(Math.cos(a) * (300 + n * 60) * k * f), y: Math.round(Math.sin(a) * (250 + n * 30) * k * f) }
    })
    const dirs = cards.map((c) => dirFor(c, { x: 0, y: 0 }))
    const boxes = inputs.map((inp, i) => at(cards[i], treeOffsets(inp, dirs[i]).box))
    return { cards, dirs, boxes }
  }
  let f = 1
  let p = place(f)
  for (let i = 0; i < 90 && collides(p.boxes); i++) {
    f *= 1.05
    p = place(f)
  }
  return { hub: { x: 0, y: 0 }, cards: p.cards, dirs: p.dirs }
}

/** Hub on top; clusters flow left-to-right in rows below (each row centred, trees grow to the right). */
export function gridLayout(inputs: ClusterInput[]): AutoLayout {
  const GAP = 50
  const boxes = inputs.map((inp) => treeOffsets(inp, 1).box)
  const sizes = boxes.map((b) => ({ w: b.r - b.l, h: b.b - b.t }))
  const area = sizes.reduce((a, s) => a + (s.w + GAP) * (s.h + GAP), 0)
  const targetW = Math.max(...sizes.map((s) => s.w), Math.sqrt(area * 1.8))

  const rows: number[][] = []
  let cur: number[] = []
  let curW = 0
  sizes.forEach((s, i) => {
    if (cur.length && curW + s.w > targetW) {
      rows.push(cur)
      cur = []
      curW = 0
    }
    cur.push(i)
    curW += s.w + GAP
  })
  if (cur.length) rows.push(cur)

  const cards: Point[] = new Array(inputs.length)
  let top = HUB_R + 90
  for (const row of rows) {
    const rowW = row.reduce((a, i) => a + sizes[i].w, 0) + (row.length - 1) * GAP
    const rowH = Math.max(...row.map((i) => sizes[i].h))
    let x = -rowW / 2
    for (const i of row) {
      cards[i] = { x: Math.round(x - boxes[i].l), y: Math.round(top + (rowH - sizes[i].h) / 2 - boxes[i].t) }
      x += sizes[i].w + GAP
    }
    top += rowH + GAP
  }
  return { hub: { x: 0, y: 0 }, cards, dirs: inputs.map(() => 1 as Dir) }
}

export function autoLayout(mode: Exclude<LayoutMode, 'free'>, inputs: ClusterInput[]): AutoLayout {
  return mode === 'grid' ? gridLayout(inputs) : radialLayout(inputs)
}
