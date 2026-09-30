import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Plus, SearchX, Sparkles } from 'lucide-react'
import { bySeverity, detectIssues } from '@shared/issues'
import type { ExpandMode, GroupKey, LayoutMode, LogKind, ServerInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import { FlowView } from '@/components/blocks/flow-view'
import { FloatingBar } from '@/components/blocks/floating-bar'
import { IssuesDialog } from '@/components/blocks/issues-dialog'
import { LogViewer } from '@/components/blocks/log-viewer'
import type { LogTarget } from '@/components/blocks/log-viewer'
import { McpDialog } from '@/components/blocks/mcp-dialog'
import { MiniView } from '@/components/blocks/mini-view'
import { ServerDetail } from '@/components/blocks/server-detail'
import { ServerDialog } from '@/components/blocks/server-dialog'
import { SettingsDialog } from '@/components/blocks/settings-dialog'
import { TopBar } from '@/components/blocks/top-bar'
import { I18nProvider, useT } from '@/lib/i18n'
import { clampScale } from '@/lib/layout'
import { useMcp } from '@/lib/mcp-client'
import type { Point } from '@/lib/layout'
import { GROUP_KEYS } from '@/lib/tree'
import { hasBackend, platform, useMonitor } from '@/lib/use-monitor'

type Monitor = ReturnType<typeof useMonitor>

function Shell({ m }: { m: Monitor }) {
  const t = useT()
  const { settings, servers, statuses, summary, api } = m
  const mode = settings.mode

  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<ServerInfo | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const { mcp, state: mcpState } = useMcp(api)
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null)
  const [query, setQuery] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [fitKey, setFitKey] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

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

  // ---- problems, search and the "problems only" filter
  const issues = useMemo(
    () => servers.flatMap((s) => detectIssues(statuses[s.id], settings.thresholds)).sort(bySeverity),
    [servers, statuses, settings.thresholds]
  )
  const problemServers = useMemo(() => new Set(issues.map((i) => i.serverId)), [issues])
  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      servers.filter(
        (s) => (!settings.problemsOnly || problemServers.has(s.id)) && (!q || `${s.name} ${s.host}`.toLowerCase().includes(q))
      ),
    [servers, settings.problemsOnly, problemServers, q]
  )

  const { updateSettings } = m
  const onLayout = useCallback((layout: LayoutMode) => updateSettings({ layout }), [updateSettings])
  const onCardScale = useCallback((cardScale: number) => updateSettings({ cardScale }), [updateSettings])
  const onFreePlacement = useCallback((positions: Record<string, Point>) => updateSettings({ layout: 'free', positions }), [updateSettings])
  const onOneCardScale = useCallback(
    (id: string, v: number) => updateSettings({ cardScales: { ...settings.cardScales, [id]: clampScale(v) } }),
    [updateSettings, settings.cardScales]
  )
  const expanded = settings.expanded
  const anyExpanded = Object.values(expanded).some((g) => Object.keys(g).length > 0)
  const onToggleGroup = useCallback(
    (id: string, group: GroupKey) => {
      const cur = { ...expanded[id] }
      if (cur[group]) delete cur[group]
      else cur[group] = 'few'
      updateSettings({ expanded: { ...expanded, [id]: cur } })
    },
    [updateSettings, expanded]
  )
  const onGroupMode = useCallback(
    (id: string, group: GroupKey, mode: ExpandMode) =>
      updateSettings({ expanded: { ...expanded, [id]: { ...expanded[id], [group]: mode } } }),
    [updateSettings, expanded]
  )
  const toggleAll = useCallback(() => {
    if (anyExpanded) return updateSettings({ expanded: {} })
    updateSettings({ expanded: Object.fromEntries(servers.map((s) => [s.id, Object.fromEntries(GROUP_KEYS.map((k) => [k, 'few']))])) })
  }, [updateSettings, anyExpanded, servers])
  const resetLayout = useCallback(() => {
    updateSettings({ positions: {}, cardScales: {} })
    setResetKey((k) => k + 1)
  }, [updateSettings])

  const openLogs = useCallback(
    (serverId: string, kind: LogKind, name: string) => {
      const s = servers.find((x) => x.id === serverId)
      if (s) setLogTarget({ serverId, serverName: s.name, kind, name })
    },
    [servers]
  )

  // "/" jumps to the search box (like most web apps), unless you are already typing somewhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const flow = {
    servers: visible,
    statuses,
    hub,
    layout: settings.layout,
    cardScale: settings.cardScale,
    cardScales: settings.cardScales,
    positions: settings.positions,
    expanded,
    resetKey,
    fitKey
  }

  const selectedInfo = servers.find((s) => s.id === selected) ?? null
  const realSelected = hasBackend && !m.isDemo

  if (!m.ready) return null

  if (mode === 'wallpaper') {
    return (
      <div className="relative h-full w-full bg-black">
        <FlowView {...flow} servers={settings.problemsOnly ? visible : servers} interactive={false} />
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
      onOpenLogs={selectedInfo ? (kind, name) => openLogs(selectedInfo.id, kind, name) : undefined}
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
  const logs = <LogViewer target={logTarget} onClose={() => setLogTarget(null)} api={api} />

  if (mode === 'mini') {
    return (
      <>
        <MiniView servers={servers} statuses={statuses} summary={summary} onMode={m.setMode} onSelect={setSelected} />
        {detail}
        {logs}
      </>
    )
  }

  const filtered = servers.length > 0 && visible.length === 0

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
        onMcp={() => setMcpOpen(true)}
        mcpActive={!!mcpState?.enabled && !!mcpState.listening}
        onResetLayout={resetLayout}
        onFit={() => setFitKey((k) => k + 1)}
        anyExpanded={anyExpanded}
        onToggleAll={toggleAll}
        isDemo={m.isDemo}
        summary={summary}
      />
      <main className="relative min-h-0 flex-1">
        <FlowView
          {...flow}
          interactive
          onSelect={setSelected}
          onFreePlacement={onFreePlacement}
          onCardScale={onOneCardScale}
          onToggleGroup={onToggleGroup}
          onGroupMode={onGroupMode}
          onOpenLogs={openLogs}
        />

        {servers.length > 0 && (
          <FloatingBar
            ref={searchRef}
            query={query}
            onQuery={setQuery}
            problemsOnly={settings.problemsOnly}
            onProblemsOnly={(problemsOnly) => updateSettings({ problemsOnly })}
            issueCount={issues.length}
            hasBad={issues.some((i) => i.severity === 'bad')}
            onOpenIssues={() => setIssuesOpen(true)}
          />
        )}

        {filtered && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
            <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card/90 px-8 py-6 text-center backdrop-blur">
              {settings.problemsOnly && !q ? <CheckCircle2 className="size-8 text-ok" /> : <SearchX className="size-8 text-subtle" />}
              <div className="text-sm text-foreground">
                {settings.problemsOnly && !q ? t('No problems right now') : t('No servers match your search')}
              </div>
            </div>
          </div>
        )}

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
      <IssuesDialog
        open={issuesOpen}
        onOpenChange={setIssuesOpen}
        issues={issues}
        servers={servers}
        statuses={statuses}
        onOpenServer={setSelected}
        onOpenLogs={(id, kind, name) => {
          setIssuesOpen(false)
          openLogs(id, kind, name)
        }}
      />
      {logs}
      <McpDialog open={mcpOpen} onOpenChange={setMcpOpen} state={mcpState} mcp={mcp} servers={servers} />
      <ServerDialog open={addOpen} onOpenChange={setAddOpen} api={api} editing={editing} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={m.updateSettings}
        demoOn={m.demoOn}
        onDemo={m.toggleDemo}
        canDemo={hasBackend}
        api={api}
        platform={platform}
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
