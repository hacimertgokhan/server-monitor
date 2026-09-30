import { describe, expect, it } from 'vitest'
import type { GroupKey } from '@shared/types'
import {
  CARD_H,
  CARD_W,
  GROUP_H,
  GROUP_W,
  HUB_R,
  LEAF_H,
  LEAF_W,
  MAX_SCALE,
  MIN_SCALE,
  autoLayout,
  clampScale,
  dirFor,
  treeOffsets
} from './layout'
import type { Box, ClusterInput, Dir } from './layout'

const rectAt = (cx: number, cy: number, w: number, h: number): Box => ({ l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 })
const overlap = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

const ALL: GroupKey[] = ['docker', 'pm2', 'services', 'ports']
const cluster = (scale: number, leaves: number[] = []): ClusterInput => ({
  scale,
  groups: leaves.map((n, i) => ({ key: ALL[i], leaves: n }))
})

/** Every node of a cluster as an absolute rectangle. */
function nodeRects(input: ClusterInput, card: { x: number; y: number }, dir: Dir): Box[] {
  const s = input.scale
  const { items } = treeOffsets(input, dir)
  return [
    rectAt(card.x, card.y, CARD_W * s, CARD_H * s),
    ...items.map((it) =>
      it.kind === 'group'
        ? rectAt(card.x + it.dx, card.y + it.dy, GROUP_W * s, GROUP_H * s)
        : rectAt(card.x + it.dx, card.y + it.dy, LEAF_W * s, LEAF_H * s)
    )
  ]
}

describe('tree offsets', () => {
  it('is just the card when nothing is expanded', () => {
    const { items, box } = treeOffsets(cluster(1), 1)
    expect(items).toEqual([])
    expect(box).toEqual({ l: -CARD_W / 2, r: CARD_W / 2, t: -CARD_H / 2, b: CARD_H / 2 })
  })

  it('never overlaps any of its own nodes, at any size or with many leaves', () => {
    for (const scale of [MIN_SCALE, 1, 1.6]) {
      for (const leaves of [[0], [1], [3, 9], [9, 9, 9, 9], [0, 12, 1, 5]]) {
        for (const dir of [1, -1] as Dir[]) {
          const rs = nodeRects(cluster(scale, leaves), { x: 0, y: 0 }, dir)
          for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i], rs[j])).toBe(false)
        }
      }
    }
  })

  it('grows away from the card on the requested side and mirrors exactly', () => {
    const input = cluster(1, [4, 4])
    const right = treeOffsets(input, 1)
    const left = treeOffsets(input, -1)
    expect(right.items.every((i) => i.dx > CARD_W / 2)).toBe(true)
    expect(left.items.every((i) => i.dx < -CARD_W / 2)).toBe(true)
    expect(left.items.map((i) => [-i.dx, i.dy])).toEqual(right.items.map((i) => [i.dx, i.dy]))
    expect(right.box.r).toBeGreaterThan(CARD_W / 2)
    expect(left.box.l).toBeLessThan(-CARD_W / 2)
  })

  it('centres each group on its leaves', () => {
    const { items } = treeOffsets(cluster(1, [5]), 1)
    const leaves = items.filter((i) => i.kind === 'leaf')
    const group = items.find((i) => i.kind === 'group')!
    expect(group.dy).toBeCloseTo((leaves[0].dy + leaves[leaves.length - 1].dy) / 2, 5)
  })

  it('bounding box contains every node', () => {
    const input = cluster(1.2, [7, 3, 0, 6])
    const { items, box } = treeOffsets(input, 1)
    for (const it of items) {
      const w = (it.kind === 'group' ? GROUP_W : LEAF_W) * 1.2
      const h = (it.kind === 'group' ? GROUP_H : LEAF_H) * 1.2
      expect(it.dx - w / 2).toBeGreaterThanOrEqual(box.l - 0.001)
      expect(it.dx + w / 2).toBeLessThanOrEqual(box.r + 0.001)
      expect(it.dy - h / 2).toBeGreaterThanOrEqual(box.t - 0.001)
      expect(it.dy + h / 2).toBeLessThanOrEqual(box.b + 0.001)
    }
  })
})

describe('auto layouts', () => {
  const scenarios: Record<string, (i: number) => number[]> = {
    collapsed: () => [],
    'one group': (i) => [i % 2 ? 3 : 9],
    'all groups': (i) => [(i % 4) + 2, 9, 9, (i % 3) * 3]
  }

  for (const mode of ['radial', 'grid'] as const) {
    for (const [name, leavesFor] of Object.entries(scenarios)) {
      for (const scale of [MIN_SCALE, 1, 1.5]) {
        for (const n of [1, 2, 3, 5, 8, 12]) {
          it(`${mode} / ${name}: ${n} servers at scale ${scale} never overlap (nodes, trees or hub)`, () => {
            const inputs = Array.from({ length: n }, (_, i) => cluster(scale, leavesFor(i)))
            const { hub, cards, dirs } = autoLayout(mode, inputs)
            expect(cards).toHaveLength(n)
            const all = inputs.map((inp, i) => nodeRects(inp, cards[i], dirs[i]))
            const hubBox = rectAt(hub.x, hub.y, HUB_R * 2, HUB_R * 2)
            for (let i = 0; i < n; i++) {
              for (const r of all[i]) expect(overlap(r, hubBox)).toBe(false)
              for (let j = i + 1; j < n; j++) for (const a of all[i]) for (const b of all[j]) expect(overlap(a, b)).toBe(false)
            }
          })
        }
      }
    }
  }

  it('handles zero servers', () => {
    expect(autoLayout('radial', []).cards).toEqual([])
    expect(autoLayout('grid', []).cards).toEqual([])
  })

  it('makes room when one card is enlarged', () => {
    const base = autoLayout('radial', [cluster(1), cluster(1), cluster(1), cluster(1)]).cards
    const big = autoLayout('radial', [cluster(1), cluster(1), cluster(1), cluster(1.6)]).cards
    expect(Math.hypot(big[0].x, big[0].y)).toBeGreaterThan(Math.hypot(base[0].x, base[0].y))
  })

  it('pushes clusters apart when a tree is opened', () => {
    const closed = autoLayout(
      'radial',
      Array.from({ length: 5 }, () => cluster(1))
    ).cards
    const open = autoLayout(
      'radial',
      Array.from({ length: 5 }, () => cluster(1, [9, 9, 9, 9]))
    ).cards
    expect(Math.hypot(open[0].x, open[0].y)).toBeGreaterThan(Math.hypot(closed[0].x, closed[0].y))
  })

  it('grows trees left for servers left of the hub, right otherwise', () => {
    expect(dirFor({ x: -300, y: 0 }, { x: 0, y: 0 })).toBe(-1)
    expect(dirFor({ x: 300, y: 0 }, { x: 0, y: 0 })).toBe(1)
    expect(dirFor({ x: 0, y: -400 }, { x: 0, y: 0 })).toBe(1)
  })
})

describe('clampScale', () => {
  it('keeps values inside the supported range', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE)
    expect(clampScale(9)).toBe(MAX_SCALE)
    expect(clampScale(1.2)).toBe(1.2)
  })
})
