import { RotateCcw, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { DEFAULT_TERMINAL, FONT_MAX, FONT_MIN } from '@shared/remote'
import type { CursorStyle, FontChoice, RightClick, TerminalSettings } from '@shared/remote'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/lib/i18n'
import { TERMINAL_THEMES } from '@/lib/terminal-themes'
import type { TermTheme } from '@/lib/terminal-themes'
import { cn } from '@/lib/utils'

interface Props {
  settings: TerminalSettings
  onChange: (patch: Partial<TerminalSettings>) => void
  onClose: () => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Choice<T extends string>({
  value,
  onChange,
  items,
  label
}: {
  value: T
  onChange: (v: T) => void
  items: { id: T; label: string }[]
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-md bg-muted p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="radio"
          aria-checked={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            'no-drag flex-1 rounded px-2 py-1 text-xs transition-colors',
            value === it.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[13px] text-foreground">
      <span className="min-w-0">{label}</span>
      {children}
    </label>
  )
}

/** A theme card that previews the real colours: background, prompt-like text and the ANSI palette. */
function ThemeCard({ theme, active, onPick }: { theme: TermTheme; active: boolean; onPick: () => void }) {
  const c = theme.colors
  const dots = [c.red, c.green, c.yellow, c.blue, c.magenta, c.cyan]
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      title={theme.name}
      className={cn(
        'no-drag overflow-hidden rounded-lg border text-left transition-all',
        active ? 'border-foreground ring-1 ring-foreground/60' : 'border-border hover:border-dim'
      )}
    >
      <div className="px-2.5 pb-2 pt-2" style={{ background: c.background }}>
        <div className="truncate font-mono text-[11px]" style={{ color: c.foreground }}>
          <span style={{ color: c.green }}>~</span> <span style={{ color: c.blue }}>$</span> ls
        </div>
        <div className="mt-1.5 flex gap-1">
          {dots.map((d) => (
            <span key={d} className="size-2 rounded-full" style={{ background: d }} />
          ))}
        </div>
      </div>
      <div className="truncate bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground">{theme.name}</div>
    </button>
  )
}

/** Live settings for the terminal. It sits next to the terminal (not over it), so changes can be judged immediately. */
export function TerminalAppearance({ settings, onChange, onClose }: Props) {
  const t = useT()
  const sameAsDefault = JSON.stringify(settings) === JSON.stringify(DEFAULT_TERMINAL)
  return (
    <aside className="no-drag flex w-72 shrink-0 flex-col border-l border-border bg-background" aria-label={t('Terminal appearance')}>
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-medium text-foreground">{t('Terminal appearance')}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={sameAsDefault}
            title={t('Reset to defaults')}
            aria-label={t('Reset to defaults')}
            onClick={() => onChange(DEFAULT_TERMINAL)}
          >
            <RotateCcw />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" title={t('Close')} aria-label={t('Close')} onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <Section title={t('Color theme')}>
          <div className="grid grid-cols-2 gap-2">
            {TERMINAL_THEMES.map((th) => (
              <ThemeCard key={th.id} theme={th} active={settings.theme === th.id} onPick={() => onChange({ theme: th.id })} />
            ))}
          </div>
        </Section>

        <Section title={t('Text')}>
          <Choice<FontChoice>
            label={t('Font')}
            value={settings.font}
            onChange={(font) => onChange({ font })}
            items={[
              { id: 'jetbrains', label: 'JetBrains Mono' },
              { id: 'system', label: t('System') }
            ]}
          />
          <Row label={t('Font size')}>
            <span className="flex items-center gap-2">
              <input
                type="range"
                aria-label={t('Font size')}
                min={FONT_MIN}
                max={FONT_MAX}
                step={1}
                value={settings.fontSize}
                onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
                className="no-drag h-1 w-24 cursor-pointer"
              />
              <span className="w-6 text-right font-mono text-xs text-muted-foreground">{settings.fontSize}</span>
            </span>
          </Row>
        </Section>

        <Section title={t('Cursor')}>
          <Choice<CursorStyle>
            label={t('Cursor')}
            value={settings.cursor}
            onChange={(cursor) => onChange({ cursor })}
            items={[
              { id: 'block', label: t('Block') },
              { id: 'bar', label: t('Bar') },
              { id: 'underline', label: t('Underline') }
            ]}
          />
          <Row label={t('Blinking cursor')}>
            <Switch checked={settings.cursorBlink} onCheckedChange={(cursorBlink) => onChange({ cursorBlink })} />
          </Row>
        </Section>

        <Section title={t('Behavior')}>
          <Row label={t('Copy on select')}>
            <Switch checked={settings.copyOnSelect} onCheckedChange={(copyOnSelect) => onChange({ copyOnSelect })} />
          </Row>
          <div className="space-y-1.5">
            <div className="text-[13px] text-foreground">{t('Right click')}</div>
            <Choice<RightClick>
              label={t('Right click')}
              value={settings.rightClick}
              onChange={(rightClick) => onChange({ rightClick })}
              items={[
                { id: 'menu', label: t('Show menu') },
                { id: 'paste', label: t('Copy / paste') }
              ]}
            />
          </div>
          <Row label={t('Scrollback lines')}>
            <select
              aria-label={t('Scrollback lines')}
              value={settings.scrollback}
              onChange={(e) => onChange({ scrollback: Number(e.target.value) })}
              className="no-drag h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:border-ring focus-visible:outline-none"
            >
              {[...new Set([1000, 5000, 10000, 50000, settings.scrollback])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()}
                  </option>
                ))}
            </select>
          </Row>
        </Section>

        <p className="text-[11.5px] leading-relaxed text-subtle">{t('Ctrl+click opens links. Ctrl+scroll changes the font size.')}</p>
      </div>
    </aside>
  )
}
