import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ExternalLink, Globe, Loader2, Mail } from 'lucide-react'
import type { Api, AppInfo, Language, Settings, UpdateInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/lib/i18n'
import { AUTHOR, CONTACT_LABEL, CONTACT_URL, REPO_URL, SITE_LABEL, SITE_URL, openLink, restoreShortcut } from '@/lib/links'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  settings: Settings
  onChange: (p: Partial<Settings>) => void
  demoOn: boolean
  onDemo: (on: boolean) => void
  canDemo: boolean
  api?: Api
  platform: string
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

const LinkButton = ({ icon: Icon, label, onClick }: { icon: typeof Globe; label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="no-drag inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-secondary"
  >
    <Icon className="size-3.5 text-muted-foreground" />
    {label}
  </button>
)

const THRESHOLD_STEPS = [80, 85, 90, 95]

function About({ api, platform }: { api?: Api; platform: string }) {
  const t = useT()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void api?.getAppInfo().then(setInfo)
  }, [api])

  const check = async (): Promise<void> => {
    if (!api) return
    setChecking(true)
    setUpdate(await api.checkUpdates())
    setChecking(false)
  }

  const os = platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : 'Windows'
  return (
    <section className="mt-2 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-foreground">Server Monitor</div>
          <div className="text-xs text-muted-foreground">
            {info ? `v${info.version} · ` : ''}
            {os} · MIT
          </div>
        </div>
        {api && (
          <Button variant="outline" size="sm" onClick={() => void check()} disabled={checking}>
            {checking && <Loader2 className="animate-spin" />}
            {t('Check for updates')}
          </Button>
        )}
      </div>

      {update && (
        <p
          className={cn(
            'mt-3 rounded-md px-3 py-2 text-xs',
            update.ok && update.newer ? 'bg-info/10 text-info' : update.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'
          )}
        >
          {!update.ok ? (
            t('Could not check for updates')
          ) : update.newer ? (
            <>
              {t('Version {v} is available.', { v: update.latest ?? '' })}{' '}
              <button type="button" className="underline" onClick={() => update.url && openLink(api, update.url)}>
                {t('Download')}
              </button>
            </>
          ) : (
            t('You are up to date.')
          )}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        {t('Made by {name}.', { name: AUTHOR })}{' '}
        {t('Updates are only checked when you press the button; nothing else leaves your computer except your SSH connections.')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <LinkButton icon={Globe} label={SITE_LABEL} onClick={() => openLink(api, SITE_URL)} />
        <LinkButton icon={ExternalLink} label="GitHub" onClick={() => openLink(api, REPO_URL)} />
        <LinkButton icon={Mail} label={CONTACT_LABEL} onClick={() => openLink(api, CONTACT_URL)} />
      </div>
    </section>
  )
}

export function SettingsDialog({ open, onOpenChange, settings, onChange, demoOn, onDemo, canDemo, api, platform }: Props) {
  const t = useT()
  const th = settings.thresholds
  const setTh = (k: 'cpu' | 'ram' | 'disk', v: number): void => onChange({ thresholds: { ...th, [k]: v } })
  const steps = (k: 'cpu' | 'ram' | 'disk'): { id: number; label: string }[] =>
    THRESHOLD_STEPS.map((n) => ({ id: n, label: `${n}%` })).concat(
      th[k] && !THRESHOLD_STEPS.includes(th[k]) ? [{ id: th[k], label: `${th[k]}%` }] : []
    )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Settings')}</DialogTitle>
          <DialogDescription>
            {t('Wallpaper mode is not clickable. Press {key} or use the tray icon to return to the window.', {
              key: restoreShortcut(platform)
            })}
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

          <Row
            title={t('Desktop notifications')}
            hint={t('Tells you when a server goes offline, load stays high, or a container, PM2 process or service fails')}
          >
            <Switch checked={settings.notifications} onCheckedChange={(v) => onChange({ notifications: v })} />
          </Row>
          <Row title={t('CPU alert above')}>
            <Pills<number> value={th.cpu} onChange={(v) => setTh('cpu', v)} items={steps('cpu')} />
          </Row>
          <Row title={t('Memory alert above')}>
            <Pills<number> value={th.ram} onChange={(v) => setTh('ram', v)} items={steps('ram')} />
          </Row>
          <Row title={t('Disk alert above')}>
            <Pills<number> value={th.disk} onChange={(v) => setTh('disk', v)} items={steps('disk')} />
          </Row>

          <Row title={t('Minimize to tray on close')} hint={t('The app keeps monitoring in the background (needed for uptime history)')}>
            <Switch checked={settings.closeToTray} onCheckedChange={(v) => onChange({ closeToTray: v })} />
          </Row>
          <Row title={t('Start at login')} hint={t('Only works in the installed (packaged) app')}>
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
        <About api={api} platform={platform} />
      </DialogContent>
    </Dialog>
  )
}
