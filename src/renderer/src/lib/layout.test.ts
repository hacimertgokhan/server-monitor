import { describe, expect, it } from 'vitest'
import { CARD_H, CARD_W, HUB_R, autoLayout, clampScale, MAX_SCALE, MIN_SCALE } from './layout'

const rect = (p: { x: number; y: number }, s: number) => ({
  l: p.x - (CARD_W * s) / 2,
  r: p.x + (CARD_W * s) / 2,
  t: p.y - (CARD_H * s) / 2,
  b: p.y + (CARD_H * s) / 2
})
const overlap = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

describe('auto layouts', () => {
  for (const mode of ['radial', 'grid'] as const) {
    for (const scale of [MIN_SCALE, 1, 1.5]) {
      for (const n of [1, 2, 3, 5, 8, 12, 20]) {
        it(`${mode}: ${n} cards at scale ${scale} never overlap each other or the hub`, () => {
          const scales = Array<number>(n).fill(scale)
          const { hub, cards } = autoLayout(mode, scales)
          expect(cards).toHaveLength(n)
          const rs = cards.map((c, i) => rect(c, scales[i]))
          for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) expect(overlap(rs[i], rs[j])).toBe(false)
            const h = { l: hub.x - HUB_R, r: hub.x + HUB_R, t: hub.y - HUB_R, b: hub.y + HUB_R }
            expect(overlap(rs[i], h)).toBe(false)
          }
        })
      }
    }
  }

  it('handles zero cards', () => {
    expect(autoLayout('radial', []).cards).toEqual([])
    expect(autoLayout('grid', []).cards).toEqual([])
  })

  it('makes room when one card is enlarged', () => {
    const base = autoLayout('radial', [1, 1, 1, 1]).cards
    const big = autoLayout('radial', [1, 1, 1, 1.6]).cards
    expect(Math.hypot(big[0].x, big[0].y)).toBeGreaterThan(Math.hypot(base[0].x, base[0].y))
  })
})

describe('clampScale', () => {
  it('keeps values inside the supported range', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE)
    expect(clampScale(9)).toBe(MAX_SCALE)
    expect(clampScale(1.2)).toBe(1.2)
  })
})
