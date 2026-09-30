import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))

export function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(digits)} ${u[i]}`
}

export const formatRate = (bps: number): string => `${formatBytes(bps)}/s`

export function formatUptime(sec: number): string {
  if (!sec || sec < 0) return '–'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function formatDuration(ms: number): string {
  return formatUptime(Math.floor(ms / 1000))
}

/** Soft status accents as hex (framer-motion can only interpolate literal colours, not CSS variables). */
export const COLORS = {
  ok: '#8fbf9f',
  caution: '#d9c47a',
  warn: '#e0a070',
  bad: '#d98282',
  info: '#7fa8d1',
  dim: '#5c5959',
  track: '#272727'
} as const

/** Soft traffic-light colour for a 0-100 utilisation value. */
export function levelColor(pct: number): string {
  if (pct >= 90) return COLORS.bad
  if (pct >= 80) return COLORS.warn
  if (pct >= 60) return COLORS.caution
  return COLORS.ok
}

export const pctText = (v: number | null | undefined, d = 2): string => (v == null ? '–' : `${v >= 99.995 ? '100' : v.toFixed(d)}%`)
