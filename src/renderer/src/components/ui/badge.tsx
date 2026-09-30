import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium leading-none', {
  variants: {
    variant: {
      default: 'bg-secondary text-foreground',
      muted: 'bg-muted text-muted-foreground',
      ok: 'bg-ok/15 text-ok',
      bad: 'bg-bad/15 text-bad',
      warn: 'bg-warn/15 text-warn',
      caution: 'bg-caution/15 text-caution',
      info: 'bg-info/15 text-info',
      outline: 'border border-border text-muted-foreground'
    }
  },
  defaultVariants: { variant: 'default' }
})

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
)
