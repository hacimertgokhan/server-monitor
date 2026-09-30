import { forwardRef } from 'react'
import { AlertTriangle, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface Props {
  query: string
  onQuery: (q: string) => void
  problemsOnly: boolean
  onProblemsOnly: (on: boolean) => void
  issueCount: number
  hasBad: boolean
  onOpenIssues: () => void
}

/** Search, "problems only" filter and the problems button, floating over the top-left of the canvas. */
export const FloatingBar = forwardRef<HTMLInputElement, Props>(function FloatingBar(
  { query, onQuery, problemsOnly, onProblemsOnly, issueCount, hasBad, onOpenIssues },
  searchRef
) {
  const t = useT()
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
      <div className="pointer-events-auto relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (onQuery(''), e.currentTarget.blur())}
          placeholder={t('Search servers…  ( / )')}
          aria-label={t('Search servers')}
          className="h-9 w-56 bg-background/85 pl-8 pr-8 text-sm backdrop-blur"
        />
        {query && (
          <button
            type="button"
            aria-label={t('Clear')}
            onClick={() => onQuery('')}
            className="no-drag absolute right-2 top-1/2 -translate-y-1/2 text-subtle hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <button
        type="button"
        aria-pressed={problemsOnly}
        onClick={() => onProblemsOnly(!problemsOnly)}
        title={t('Show only servers with problems')}
        className={cn(
          'pointer-events-auto no-drag inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm backdrop-blur transition-colors',
          problemsOnly
            ? 'border-foreground/40 bg-secondary text-foreground'
            : 'border-border bg-background/85 text-muted-foreground hover:text-foreground'
        )}
      >
        {t('Problems only')}
      </button>

      <button
        type="button"
        onClick={onOpenIssues}
        title={t('Problems')}
        aria-label={t('Problems')}
        className={cn(
          'pointer-events-auto no-drag inline-flex h-9 items-center gap-2 rounded-md border bg-background/85 px-3 text-sm backdrop-blur transition-colors hover:text-foreground',
          issueCount === 0 ? 'border-border text-muted-foreground' : hasBad ? 'border-bad/50 text-bad' : 'border-warn/50 text-warn'
        )}
      >
        <AlertTriangle className="size-4" />
        <span className="font-mono tabular-nums">{issueCount}</span>
      </button>
    </div>
  )
})
