import { useEffect, useId } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { COLORS, cn, levelColor } from '@/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as const

/** Number that glides to its new value instead of jumping. */
export function AnimatedNumber({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => `${v.toFixed(decimals)}${suffix}`)
  useEffect(() => {
    const c = animate(mv, value, { duration: 1.2, ease: EASE })
    return () => c.stop()
  }, [value, mv])
  return <motion.span>{text}</motion.span>
}

interface RingProps {
  value: number
  label: string
  sub?: string
  size?: number
  stroke?: number
  dim?: boolean
  className?: string
}

/** Circular gauge; arc length and colour both tween smoothly as the value changes. */
export function RingGauge({ value, label, sub, size = 66, stroke = 6, dim, className }: RingProps) {
  const v = Math.max(0, Math.min(100, value || 0))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className={cn('flex flex-col items-center gap-0.5', dim && 'opacity-40', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.track} strokeWidth={stroke} />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c, stroke: levelColor(v) }}
            animate={{ strokeDashoffset: c * (1 - v / 100), stroke: levelColor(v) }}
            transition={{ duration: 1.3, ease: EASE }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[16px] font-semibold tabular-nums text-foreground">
          <AnimatedNumber value={v} suffix="%" />
        </div>
      </div>
      <div className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      {sub !== undefined && <div className="max-w-[92px] truncate text-[11.5px] text-subtle">{sub}</div>}
    </div>
  )
}

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

/** Smooth area sparkline for a 0-100 series. */
export function Sparkline({
  values,
  width = 268,
  height = 34,
  color = COLORS.info
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  const id = useId()
  const pad = 2
  const data = values.length > 1 ? values : [0, 0]
  const pts = data.map((v, i): [number, number] => [
    (i / (data.length - 1)) * width,
    pad + (1 - Math.max(0, Math.min(100, v)) / 100) * (height - pad * 2)
  ])
  const line = smoothPath(pts)
  const area = `${line} L${width},${height} L0,${height} Z`
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} className="spark-path" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="spark-path"
      />
    </svg>
  )
}

/** Horizontal bar with the same smooth easing as the rings. */
export function Bar({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value || 0))
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-secondary', className)}>
      <motion.div
        className="h-full rounded-full"
        initial={false}
        animate={{ width: `${v}%`, backgroundColor: levelColor(v) }}
        transition={{ duration: 1.2, ease: EASE }}
      />
    </div>
  )
}
