import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, PanelLeftClose, PanelLeftOpen, Plus, Search, Server, SquareTerminal, X } from 'lucide-react'
import { normalizeTerminal } from '@shared/remote'
import type { TermState, TerminalSettings, Transfer } from '@shared/remote'
import type { ServerInfo, ServerStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import type { Remote } from '@/lib/remote'
import { shellQuote } from '@/lib/shell'
import { cn } from '@/lib/utils'
import { FilesPane } from './files-pane'
import { TerminalPane } from './terminal-pane'
import { StateDot } from './server-node'

export interface OpenRequest {
  serverId: string
  kind: 'terminal' | 'files'
  /** Changes on every request so asking for the same thing twice still works. */
  nonce: number
}

interface Props {
  servers: ServerInfo[]
  statuses: Record<string, ServerStatus>
  remote: Remote
  terminal: TerminalSettings
  onTerminalSettings: (patch: Partial<TerminalSettings>) => void
  /** Root mode is not the current view: sessions stay alive but nothing is shown. */
  hidden: boolean
  request: OpenRequest | null
  onAddServer: () => void
}

interface Tab {
  id: string
  kind: 'terminal' | 'files'
  serverId: string
  initialCommand?: string
}

const COLLAPSE_KEY = 'server-monitor:root-sidebar'
const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

const MAX_TRANSFERS = 50
let tabSeq = 0

/**
 * "Root mode": a workspace like Termius. Servers are listed on the left; clicking one opens a real SSH terminal in
 * front of you, next to file-manager (SFTP) tabs. Sessions stay alive when you switch back to the flowchart.
 */
export function RootView({ servers, statuses, remote, terminal, onTerminalSettings, hidden, request, onAddServer }: Props) {
  const t = useT()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [conn, setConn] = useState<Record<string, TermState>>({})
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const termSettings = useMemo(() => normalizeTerminal(terminal), [terminal])

  const byId = useMemo(() => new Map(servers.map((s) => [s.id, s])), [servers])

  // Tabs are mirrored in a ref so several quick calls (and event handlers) always see the latest list.
  const tabsRef = useRef<Tab[]>([])
  const setTabList = useCallback((next: Tab[]): void => {
    tabsRef.current = next
    setTabs(next)
  }, [])

  const openTab = useCallback(
    (serverId: string, kind: Tab['kind'], opts: { reuse?: boolean; initialCommand?: string } = {}): void => {
      const cur = tabsRef.current
      const existing = opts.reuse && !opts.initialCommand ? cur.find((x) => x.serverId === serverId && x.kind === kind) : undefined
      if (existing) return setActiveId(existing.id)
      const tab: Tab = { id: `tab-${++tabSeq}`, kind, serverId, initialCommand: opts.initialCommand }
      setTabList([...cur, tab])
      setActiveId(tab.id)
    },
    [setTabList]
  )

  // Requests coming from the flowchart ("Terminal" / "Files" buttons).
  const lastNonce = useRef(0)
  useEffect(() => {
    if (!request || request.nonce === lastNonce.current) return
    lastNonce.current = request.nonce
    openTab(request.serverId, request.kind, { reuse: request.kind === 'files' })
  }, [request, openTab])

  const closeTab = useCallback(
    (id: string): void => {
      const cur = tabsRef.current
      const i = cur.findIndex((x) => x.id === id)
      if (i < 0) return
      const next = cur.filter((x) => x.id !== id)
      setTabList(next)
      setActiveId((a) => (a !== id ? a : (next[Math.min(i, next.length - 1)]?.id ?? null)))
      setConn((c) => {
        const { [id]: _gone, ...rest } = c
        return rest
      })
    },
    [setTabList]
  )

  // A removed server takes its tabs with it.
  useEffect(() => {
    const cur = tabsRef.current
    const keep = cur.filter((x) => byId.has(x.serverId))
    if (keep.length === cur.length) return
    setTabList(keep)
    setActiveId((a) => (keep.some((x) => x.id === a) ? a : (keep[0]?.id ?? null)))
  }, [byId, setTabList])

  // Transfers of every server arrive here; each file manager shows its own.
  useEffect(
    () =>
      remote.sftp.onTransfer((tr) =>
        setTransfers((cur) => {
          const i = cur.findIndex((x) => x.id === tr.id)
          if (i >= 0) return cur.map((x, j) => (j === i ? tr : x))
          return [tr, ...cur].slice(0, MAX_TRANSFERS)
        })
      ),
    [remote]
  )

  const toggleSidebar = (): void => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        /* storage unavailable */
      }
      return !c
    })
  }

  const q = query.trim().toLowerCase()
  const list = servers.filter((s) => !q || `${s.name} ${s.host} ${s.username}`.toLowerCase().includes(q))
  const active = tabs.find((x) => x.id === activeId) ?? null

  const label = (tab: Tab): string => {
    const name = byId.get(tab.serverId)?.name ?? '?'
    const same = tabs.filter((x) => x.serverId === tab.serverId && x.kind === tab.kind)
    return same.length > 1 ? `${name} #${same.indexOf(tab) + 1}` : name
  }

  return (
    <div className={cn('flex min-h-0 flex-1 bg-background', hidden && 'hidden')}>
      {/* ---------------------------------------------------------- server list */}
      <aside
        className={cn('no-drag flex shrink-0 flex-col border-r border-border bg-card transition-[width]', collapsed ? 'w-12' : 'w-64')}
      >
        <div
          className={cn(
            'flex h-9 shrink-0 items-center border-b border-border',
            collapsed ? 'justify-center' : 'justify-between pl-3 pr-1.5'
          )}
        >
          {!collapsed && (
            <span className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t('Servers')}</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
            aria-label={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
            onClick={toggleSidebar}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>

        {!collapsed && servers.length > 4 && (
          <label className="relative m-2 mb-1 flex items-center">
            <Search className="pointer-events-none absolute left-2 size-3.5 text-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Search servers')}
              aria-label={t('Search servers')}
              className="no-drag h-8 w-full select-text rounded-md border border-input bg-background pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-subtle focus-visible:border-ring"
            />
          </label>
        )}

        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5" aria-label={t('Servers')}>
          {list.map((s) => {
            const isActive = active?.serverId === s.id
            const open = tabs.filter((x) => x.serverId === s.id).length
            return (
              <div
                key={s.id}
                className={cn(
                  'group flex items-center gap-2 rounded-lg transition-colors',
                  collapsed ? 'justify-center p-1.5' : 'px-2 py-1.5',
                  isActive ? 'bg-accent' : 'hover:bg-muted'
                )}
              >
                <button
                  type="button"
                  title={collapsed ? `${s.name} (${s.username}@${s.host})` : t('Open terminal')}
                  onClick={() => openTab(s.id, 'terminal', { reuse: true })}
                  className="no-drag flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  {collapsed ? (
                    <span className="relative flex size-7 items-center justify-center rounded-md bg-secondary text-xs font-medium uppercase text-foreground">
                      {s.name.slice(0, 1)}
                      <StateDot status={statuses[s.id]} className="absolute -right-0.5 -top-0.5 size-1.5" />
                    </span>
                  ) : (
                    <>
                      <StateDot status={statuses[s.id]} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">{s.name}</span>
                        <span className="block truncate font-mono text-[11.5px] text-subtle">
                          {s.username}@{s.host}
                        </span>
                      </span>
                      {open > 0 && (
                        <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{open}</span>
                      )}
                    </>
                  )}
                </button>
                {!collapsed && (
                  <span className="flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title={t('New terminal')}
                      aria-label={`${t('New terminal')}: ${s.name}`}
                      onClick={() => openTab(s.id, 'terminal')}
                    >
                      <Plus />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title={t('Files (SFTP)')}
                      aria-label={`${t('Files (SFTP)')}: ${s.name}`}
                      onClick={() => openTab(s.id, 'files', { reuse: true })}
                    >
                      <FolderOpen />
                    </Button>
                  </span>
                )}
              </div>
            )
          })}
          {servers.length === 0 && !collapsed && (
            <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
              <Server className="size-6 text-subtle" />
              <p className="text-xs text-muted-foreground">{t('No servers yet')}</p>
              <Button size="sm" onClick={onAddServer}>
                <Plus /> {t('Add server')}
              </Button>
            </div>
          )}
          {servers.length > 0 && list.length === 0 && !collapsed && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('No servers match your search')}</p>
          )}
        </nav>
      </aside>

      {/* ---------------------------------------------------------- tabs + content */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div
          className="no-drag flex h-9 shrink-0 items-stretch border-b border-border bg-background"
          role="tablist"
          aria-label={t('Sessions')}
        >
          <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
            {tabs.map((tab) => {
              const on = tab.id === activeId
              const st = conn[tab.id]
              return (
                <div
                  key={tab.id}
                  role="tab"
                  aria-selected={on}
                  tabIndex={0}
                  onClick={() => setActiveId(tab.id)}
                  onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setActiveId(tab.id)}
                  className={cn(
                    'group flex max-w-52 shrink-0 cursor-default items-center gap-2 border-r border-border px-3 text-xs transition-colors',
                    on
                      ? 'bg-card text-foreground shadow-[inset_0_-2px_0_var(--foreground)]'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {tab.kind === 'terminal' ? (
                    <span className="relative flex shrink-0">
                      <SquareTerminal className="size-3.5" />
                      <span
                        className={cn(
                          'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full',
                          st === 'open' ? 'bg-ok' : st === 'closed' ? 'bg-bad' : 'animate-pulse bg-caution'
                        )}
                      />
                    </span>
                  ) : (
                    <FolderOpen className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{label(tab)}</span>
                  <button
                    type="button"
                    aria-label={`${t('Close')}: ${label(tab)}`}
                    title={t('Close')}
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.id)
                    }}
                    className="no-drag shrink-0 rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100 group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>
          {active && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 rounded-none"
              title={t('New terminal')}
              aria-label={t('New terminal')}
              onClick={() => openTab(active.serverId, 'terminal')}
            >
              <Plus />
            </Button>
          )}
        </div>

        <div className="relative min-h-0 flex-1">
          {tabs.map((tab) => {
            const info = byId.get(tab.serverId)
            if (!info) return null
            const on = tab.id === activeId && !hidden
            return (
              <div key={tab.id} className={cn('absolute inset-0', !on && 'hidden')} role="tabpanel">
                {tab.kind === 'terminal' ? (
                  <TerminalPane
                    info={info}
                    remote={remote}
                    settings={termSettings}
                    onSettings={onTerminalSettings}
                    active={on}
                    initialCommand={tab.initialCommand}
                    onState={(s) => setConn((c) => (c[tab.id] === s ? c : { ...c, [tab.id]: s }))}
                    onOpenFiles={() => openTab(info.id, 'files', { reuse: true })}
                  />
                ) : (
                  <FilesPane
                    info={info}
                    remote={remote}
                    transfers={transfers.filter((x) => x.serverId === info.id)}
                    onDismissTransfer={(id) => setTransfers((cur) => cur.filter((x) => x.id !== id))}
                    onClearFinished={() => setTransfers((cur) => cur.filter((x) => x.serverId !== info.id || x.state === 'running'))}
                    onOpenTerminalHere={(path) => openTab(info.id, 'terminal', { initialCommand: `cd ${shellQuote(path)} && clear` })}
                  />
                )}
              </div>
            )
          })}

          {tabs.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card">
                <SquareTerminal className="size-7 text-muted-foreground" />
              </div>
              <h2 className="text-base font-medium text-foreground">
                {servers.length ? t('Pick a server on the left') : t('No servers yet')}
              </h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                {servers.length
                  ? t('Click a server to open an SSH terminal. Use the folder icon next to it for the file manager (SFTP).')
                  : t('Add your SSH details and CPU, RAM, disk, Docker, PM2, services and ports show up live.')}
              </p>
              {servers.length === 0 && (
                <Button size="sm" onClick={onAddServer}>
                  <Plus /> {t('Add server')}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
