import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  /** Shortcut hint shown on the right, e.g. "Ctrl+Shift+C". */
  hint?: string
  danger?: boolean
  disabled?: boolean
  /** A thin line is drawn above the item. */
  separator?: boolean
  onSelect: () => void
}

/** A small right-click menu at a fixed position. Closes on outside click, Escape, scroll or window blur. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4))
    })
  }, [x, y, items.length])

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('wheel', onClose, { passive: true })
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('wheel', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="no-drag fixed z-[60] min-w-48 select-none rounded-lg border border-border bg-popover p-1 text-sm shadow-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <div key={it.id}>
          {it.separator && <div className="my-1 h-px bg-border" />}
          <button
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onSelect()
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40',
              it.danger ? 'text-bad hover:bg-bad/15' : 'text-foreground hover:bg-accent'
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5">{it.icon}</span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="shrink-0 font-mono text-[11px] text-subtle">{it.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  )
}
