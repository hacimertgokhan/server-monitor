import { useCallback, useMemo, useState } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import type { LayoutMode, ServerInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import { FlowView } from '@/components/blocks/flow-view'
import { MiniView } from '@/components/blocks/mini-view'
import { ServerDetail } from '@/components/blocks/server-detail'
import { ServerDialog } from '@/components/blocks/server-dialog'
import { SettingsDialog } from '@/components/blocks/settings-dialog'
import { TopBar } from '@/components/blocks/top-bar'
import { I18nProvider, useT } from '@/lib/i18n'
import { clampScale } from '@/lib/layout'
import type { Point } from '@/lib/layout'
import { hasBackend, useMonitor } from '@/lib/use-monitor'

type Monitor = ReturnType<typeof useMonitor>

function Shell({ m }: { m: Monitor }) {
  const t = useT()
  const { settings, servers, statuses, summary, api } = m
  const mode = settings.mode

  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<ServerInfo | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [fitKey, setFitKey] = useState(0)

  const hub = useMemo(
    () => ({
      total: summary.total,
      online: summary.online,
      avgCpu: summary.avgCpu,
      avgMem: summary.avgMem,
      rx: summary.rx,
      tx: summary.tx
    }),
    [summary]
  )

  const { updateSettings } = m
  const onLayout = useCallback((layout: LayoutMode) => updateSettings({ layout }), [updateSettings])
  const onCardScale = useCallback((cardScale: number) => updateSettings({ cardScale }), [updateSettings])
  const onFreePlacement = useCallback((positions: Record<string, Point>) => updateSettings({ layout: 'free', positions }), [updateSettings])
  const onOneCardScale = useCallback(
    (id: string, v: number) => updateSettings({ cardScales: { ...settings.cardScales, [id]: clampScale(v) } }),
    [updateSettings, settings.cardScales]
  )
  const resetLayout = useCallback(() => {
    updateSettings({ positions: {}, cardScales: {} })
    setResetKey((k) => k + 1)
  }, [updateSettings])

  const flow = {
    servers,
    statuses,
    hub,
    layout: settings.layout,
    cardScale: settings.cardScale,
    cardScales: settings.cardScales,
    positions: settings.positions,
    resetKey,
    fitKey
  }

  const selectedInfo = servers.find((s) => s.id === selected) ?? null
  const realSelected = hasBackend && !m.isDemo

  if (!m.ready) return null

  if (mode === 'wallpaper') {
    return (
      <div className="relative h-full w-full bg-black">
        <FlowView {...flow} interactive={false} />
        {!hasBackend && (
          <button
            className="absolute bottom-3 right-3 rounded bg-secondary px-2 py-1 text-xs text-foreground"
            onClick={() => m.setMode('window')}
          >
            {t('Exit')}
          </button>
        )}
      </div>
    )
  }

  const detail = (
    <ServerDetail
      info={selectedInfo}
      status={selectedInfo ? statuses[selectedInfo.id] : undefined}
      onClose={() => setSelected(null)}
      onEdit={
        realSelected
          ? () => {
              setEditing(selectedInfo)
              setSelected(null)
              setAddOpen(true)
            }
          : undefined
      }
      onDelete={
        realSelected
          ? () => {
              if (selectedInfo && window.confirm(t('Remove "{name}" from monitoring?', { name: selectedInfo.name }))) {
                void api?.removeServer(selectedInfo.id)
                setSelected(null)
              }
            }
          : undefined
      }
    />
  )

  if (mode === 'mini') {
    return (
      <>
        <MiniView servers={servers} statuses={statuses} summary={summary} onMode={m.setMode} onSelect={setSelected} />
        {detail}
      </>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <TopBar
        mode={mode}
        onMode={m.setMode}
        layout={settings.layout}
        onLayout={onLayout}
        cardScale={settings.cardScale}
        onCardScale={onCardScale}
        onAdd={() => {
          setEditing(null)
          setAddOpen(true)
        }}
        onSettings={() => setSettingsOpen(true)}
        onResetLayout={resetLayout}
        onFit={() => setFitKey((k) => k + 1)}
        isDemo={m.isDemo}
        summary={summary}
      />
      <main className="relative min-h-0 flex-1">
        <FlowView {...flow} interactive onSelect={setSelected} onFreePlacement={onFreePlacement} onCardScale={onOneCardScale} />

        {servers.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center px-4">
            <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-xl border border-border bg-card/90 px-8 py-5 text-center backdrop-blur">
              <div className="text-sm text-foreground">{t('No servers yet')}</div>
              <div className="max-w-xs text-xs text-muted-foreground">
                {t('Add your SSH details and CPU, RAM, disk, Docker, PM2, services and ports show up live.')}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus /> {t('Add server')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => m.toggleDemo(true)}>
                  <Sparkles /> {t('Preview with demo')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>

      {detail}
      <ServerDialog open={addOpen} onOpenChange={setAddOpen} api={api} editing={editing} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={m.updateSettings}
        demoOn={m.demoOn}
        onDemo={m.toggleDemo}
        canDemo={hasBackend}
      />
    </div>
  )
}

export default function App() {
  const m = useMonitor()
  return (
    <I18nProvider pref={m.settings.language}>
      <Shell m={m} />
    </I18nProvider>
  )
}
