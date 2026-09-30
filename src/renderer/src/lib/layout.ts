import type { LayoutMode } from '@shared/types'

export interface Point {
  x: number
  y: number
}

export interface AutoLayout {
  hub: Point
  cards: Point[]
}

/** Card width at scale 1 (px, flow units). Heights vary (~230 offline, ~315 online). */
export const CARD_W = 300
export const CARD_H = 330
export const HUB_R = 115

export const MIN_SCALE = 0.6
export const MAX_SCALE = 1.8
export const clampScale = (v: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, v))

/** Do any two cards (or a card and the hub) overlap, with a small gutter? */
function collides(cards: Point[], scales: number[]): boolean {
  const gap = 24
  const half = (i: number): { w: number; h: number } => ({ w: (CARD_W * scales[i]) / 2 + gap / 2, h: (CARD_H * scales[i]) / 2 + gap / 2 })
  for (let i = 0; i < cards.length; i++) {
    const a = half(i)
    if (Math.abs(cards[i].x) < a.w + HUB_R && Math.abs(cards[i].y) < a.h + HUB_R) return true
    for (let j = i + 1; j < cards.length; j++) {
      const b = half(j)
      if (Math.abs(cards[i].x - cards[j].x) < a.w + b.w && Math.abs(cards[i].y - cards[j].y) < a.h + b.h) return true
    }
  }
  return false
}

/** Cards on an ellipse around the hub at (0,0); the ellipse grows until no card touches another. */
export function radialLayout(scales: number[]): AutoLayout {
  const n = scales.length
  const k = Math.max(1, ...scales)
  const at = (f: number): Point[] =>
    scales.map((_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1) + (n === 2 ? Math.PI / 2 : 0)
      return { x: Math.round(Math.cos(a) * (300 + n * 60) * k * f), y: Math.round(Math.sin(a) * (250 + n * 30) * k * f) }
    })
  let f = 1
  let cards = at(f)
  for (let i = 0; i < 60 && collides(cards, scales); i++) {
    f *= 1.05
    cards = at(f)
  }
  return { hub: { x: 0, y: 0 }, cards }
}

/** Hub on top, cards in evenly spaced rows below (last row centred). */
export function gridLayout(scales: number[]): AutoLayout {
  const n = scales.length
  const k = Math.max(1, ...scales)
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.8)))
  const cellW = CARD_W * k + 50
  const cellH = CARD_H * k + 50
  const cards = scales.map((_, i) => {
    const row = Math.floor(i / cols)
    const inRow = Math.min(cols, n - row * cols)
    const col = i - row * cols
    return {
      x: Math.round((col - (inRow - 1) / 2) * cellW),
      y: Math.round(HUB_R + 90 + cellH / 2 + row * cellH)
    }
  })
  return { hub: { x: 0, y: 0 }, cards }
}

export function autoLayout(mode: Exclude<LayoutMode, 'free'>, scales: number[]): AutoLayout {
  return mode === 'grid' ? gridLayout(scales) : radialLayout(scales)
}
