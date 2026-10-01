import { describe, expect, it } from 'vitest'
import { DEFAULT_TERMINAL, normalizeTerminal } from '@shared/remote'
import { TERMINAL_THEMES, getTerminalTheme } from './terminal-themes'

const HEX = /^#[0-9a-f]{6}$/i

describe('terminal themes', () => {
  it('has unique ids and a valid #rrggbb value in every colour slot', () => {
    expect(new Set(TERMINAL_THEMES.map((t) => t.id)).size).toBe(TERMINAL_THEMES.length)
    for (const t of TERMINAL_THEMES) {
      const entries = Object.entries(t.colors)
      expect(entries.length, t.id).toBe(21)
      for (const [slot, value] of entries) expect(value, `${t.id}.${slot}`).toMatch(HEX)
    }
  })

  it('offers both dark and light themes', () => {
    expect(TERMINAL_THEMES.some((t) => t.dark)).toBe(true)
    expect(TERMINAL_THEMES.some((t) => !t.dark)).toBe(true)
  })

  it('keeps text readable: foreground contrasts with the background', () => {
    const lum = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    for (const t of TERMINAL_THEMES) {
      const a = lum(t.colors.background)
      const b = lum(t.colors.foreground)
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      expect(ratio, `${t.name} contrast`).toBeGreaterThan(3.5)
    }
  })

  it('falls back to the default theme for unknown ids, and the default exists', () => {
    expect(getTerminalTheme('does-not-exist').id).toBe(DEFAULT_TERMINAL.theme)
    expect(TERMINAL_THEMES.some((t) => t.id === DEFAULT_TERMINAL.theme)).toBe(true)
  })
})

describe('normalizeTerminal', () => {
  it('returns defaults for missing or garbage input', () => {
    expect(normalizeTerminal(undefined)).toEqual(DEFAULT_TERMINAL)
    expect(normalizeTerminal('nope')).toEqual(DEFAULT_TERMINAL)
    expect(normalizeTerminal({ fontSize: 'big', cursor: 'wide', scrollback: NaN, theme: 5 })).toEqual(DEFAULT_TERMINAL)
  })

  it('clamps numbers and keeps valid choices', () => {
    const n = normalizeTerminal({ fontSize: 100, scrollback: 1, cursor: 'bar', font: 'system', copyOnSelect: true, rightClick: 'paste' })
    expect(n).toMatchObject({ fontSize: 28, scrollback: 500, cursor: 'bar', font: 'system', copyOnSelect: true, rightClick: 'paste' })
    expect(normalizeTerminal({ fontSize: 3 }).fontSize).toBe(9)
    expect(normalizeTerminal({ fontSize: 13.6 }).fontSize).toBe(14)
  })
})
