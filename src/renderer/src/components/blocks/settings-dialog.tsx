import type { ReactNode } from 'react'
import type { Language, Settings } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  settings: Settings
  onChange: (p: Partial<Settings>) => void
  demoOn: boolean
  onDemo: (on: boolean) => void
  canDemo: boolean
}

const Row = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border py-3 last:border-0">
    <div className="min-w-0 flex-1">
      <div className="text-sm text-foreground">{title}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
    {children}
  </div>
)

function Pills<T extends string | number>({
  value,
  onChange,
  items
}: {
  value: T
  onChange: (v: T) => void
  items: { id: T; label: string }[]
}) {
  return (
    <div className="flex gap-1 rounded-md bg-muted p-1">
      {items.map((it) => (
        <button
          key={String(it.id)}
          onClick={() => onChange(it.id)}
          className={cn(
            'no-drag rounded px-2.5 py-1 text-xs transition-colors',
            value === it.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange, settings, onChange, demoOn, onDemo, canDemo }: Props) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Settings')}</DialogTitle>
          <DialogDescription>
            {t('Wallpaper mode is not clickable. Press {key} or use the tray icon to return to the window.', { key: 'Ctrl+Alt+M' })}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Row title={t('Language')}>
            <Pills<Language>
              value={settings.language}
              onChange={(language) => onChange({ language })}
              items={[
                { id: 'auto', label: t('Auto') },
                { id: 'en', label: 'English' },
                { id: 'tr', label: 'Türkçe' }
              ]}
            />
          </Row>
          <Row title={t('Refresh interval')} hint={t('How often servers are polled')}>
            <Pills<number>
              value={settings.pollSec}
              onChange={(pollSec) => onChange({ pollSec })}
              items={[2, 3, 5, 10].map((n) => ({ id: n, label: t('{n} s', { n }) }))}
            />
          </Row>
          <Row title={t('Minimize to tray on close')} hint={t('The app keeps monitoring in the background (needed for uptime history)')}>
            <Switch checked={settings.closeToTray} onCheckedChange={(v) => onChange({ closeToTray: v })} />
          </Row>
          <Row title={t('Start with Windows')} hint={t('Only works in the installed (packaged) app')}>
            <Switch checked={settings.autoStart} onCheckedChange={(v) => onChange({ autoStart: v })} />
          </Row>
          <Row title={t('Mini mode always on top')}>
            <Switch checked={settings.miniOnTop} onCheckedChange={(v) => onChange({ miniOnTop: v })} />
          </Row>
          {canDemo && (
            <Row title={t('Demo data')} hint={t('Shows fake servers for previewing when none are configured')}>
              <Switch checked={demoOn} onCheckedChange={onDemo} />
            </Row>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
