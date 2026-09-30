import { memo, useEffect, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { ArrowDown, ArrowUp, User } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { COLORS, formatRate } from '@/lib/utils'
import { AnimatedNumber } from './motion'

export interface HubData extends Record<string, unknown> {
  total: number
  online: number
  avgCpu: number
  avgMem: number
  rx: number
  tx: number
}
export type HubFlowNode = Node<HubData, 'hub'>

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

function HubNodeImpl({ data }: NodeProps<HubFlowNode>) {
  const { t, locale } = useI18n()
  const now = useClock()
  const allUp = data.total > 0 && data.online === data.total
  const tone = data.total === 0 ? COLORS.dim : allUp ? COLORS.ok : data.online === 0 ? COLORS.bad : COLORS.warn
  return (
    <div className="relative flex size-[230px] items-center justify-center">
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Top} />
      {[0, 1.5, 3].map((delay) => (
        <span
          key={delay}
          className="hub-ring absolute inset-0 rounded-full border"
          style={{ borderColor: tone, animationDelay: `${delay}s` }}
        />
      ))}
      <div
        className="relative flex size-full flex-col items-center justify-center rounded-full border bg-card text-center shadow-[0_0_80px_-20px_rgba(201,199,199,0.25)]"
        style={{ borderColor: `${tone}66` }}
      >
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
          <User className="size-3" /> {t('Me')}
        </div>
        <div className="mt-1 text-[44px] font-extralight leading-none tabular-nums tracking-tight text-foreground">
          {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })}
        </div>
        <div className="mt-1 text-[12px] text-muted-foreground">
          {now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[12px]" style={{ color: tone }}>
          <span className="size-1.5 rounded-full" style={{ background: tone }} />
          {data.total === 0 ? t('No servers') : t('{online}/{total} online', { online: data.online, total: data.total })}
        </div>
        {data.online > 0 && (
          <div className="mt-1 flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
            <span>
              CPU <AnimatedNumber value={data.avgCpu} suffix="%" />
            </span>
            <span>
              RAM <AnimatedNumber value={data.avgMem} suffix="%" />
            </span>
          </div>
        )}
        {data.online > 0 && (
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[11.5px] text-subtle">
            <span className="inline-flex items-center gap-0.5">
              <ArrowDown className="size-2.5" />
              {formatRate(data.rx)}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <ArrowUp className="size-2.5" />
              {formatRate(data.tx)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export const HubNode = memo(HubNodeImpl)
