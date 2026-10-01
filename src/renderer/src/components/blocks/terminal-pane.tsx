import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  ClipboardPaste,
  Eraser,
  FolderOpen,
  Loader2,
  Palette,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { FONT_MAX, FONT_MIN } from '@shared/remote'
import type { TermState, TerminalSettings } from '@shared/remote'
import type { ServerInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ContextMenu } from '@/components/ui/context-menu'
import type { MenuItem } from '@/components/ui/context-menu'
import { useT } from '@/lib/i18n'
import type { Remote } from '@/lib/remote'
import { FONT_STACKS, getTerminalTheme } from '@/lib/terminal-themes'
import { isMac } from '@/lib/use-monitor'
import { cn } from '@/lib/utils'
import { TerminalAppearance } from './terminal-appearance'

interface Props {
  info: ServerInfo
  remote: Remote
  settings: TerminalSettings
  onSettings: (patch: Partial<TerminalSettings>) => void
  /** This tab is the visible one (hidden terminals keep running but cannot be measured). */
  active: boolean
  /** Typed into the shell as soon as it is ready (used by "open terminal here"). */
  initialCommand?: string
  /** Connection state, for the tab's status dot. */
  onState?: (state: TermState) => void
  onOpenFiles?: () => void
}

interface Conn {
  state: TermState
  error?: string
  code?: number | null
}

const termOptions = (s: TerminalSettings): ConstructorParameters<typeof Terminal>[0] => ({
  fontFamily: FONT_STACKS[s.font],
  fontSize: s.fontSize,
  cursorStyle: s.cursor,
  cursorBlink: s.cursorBlink,
  scrollback: s.scrollback,
  theme: getTerminalTheme(s.theme).colors,
  allowProposedApi: true,
  macOptionIsMeta: true,
  minimumContrastRatio: 1,
  allowTransparency: false
})

export function TerminalPane({ info, remote, settings, onSettings, active, initialCommand, onState, onOpenFiles }: Props) {
  const t = useT()
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const idRef = useRef<string | null>(null)
  const activeRef = useRef(active)
  const settingsRef = useRef(settings)
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState(0)
  const [conn, setConn] = useState<Conn>({ state: 'connecting' })
  const [title, setTitle] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [appearance, setAppearance] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const findInput = useRef<HTMLInputElement>(null)

  const onSettingsRef = useRef(onSettings)
  onSettingsRef.current = onSettings
  activeRef.current = active
  settingsRef.current = settings

  const copySelection = useCallback((): void => {
    const term = termRef.current
    const sel = term?.getSelection()
    if (sel) void remote.clipboard.writeText(sel)
  }, [remote])

  const paste = useCallback(async (): Promise<void> => {
    const text = await remote.clipboard.readText()
    if (text) termRef.current?.paste(text)
    termRef.current?.focus()
  }, [remote])

  const fit = useCallback((): void => {
    const el = host.current
    if (!el || !activeRef.current || el.offsetWidth < 20 || el.offsetHeight < 20) return
    try {
      fitRef.current?.fit()
    } catch {
      /* not laid out yet */
    }
  }, [])

  const openFind = useCallback((): void => {
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInput.current?.focus()
      findInput.current?.select()
    })
  }, [])

  // ---- create the terminal once
  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    let term: Terminal | null = null
    let ro: ResizeObserver | null = null
    let selTimer: ReturnType<typeof setTimeout> | undefined

    const create = (): void => {
      if (disposed || !host.current) return
      const s = settingsRef.current
      term = new Terminal(termOptions(s))
      const fitAddon = new FitAddon()
      const searchAddon = new SearchAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(searchAddon)
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = '11'
      term.loadAddon(
        new WebLinksAddon((e, uri) => {
          if (e.ctrlKey || e.metaKey) remote.openWebLink(uri) // plain clicks are for selecting text
        })
      )
      term.open(host.current)
      try {
        const gl = new WebglAddon()
        gl.onContextLoss(() => gl.dispose())
        term.loadAddon(gl)
      } catch {
        /* no WebGL: xterm falls back to its DOM renderer */
      }
      termRef.current = term
      fitRef.current = fitAddon
      searchRef.current = searchAddon

      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true
        const mod = isMac ? e.metaKey : e.ctrlKey
        const key = e.code
        // Copy: Cmd+C (macOS), Ctrl+Shift+C, or Ctrl+C while text is selected (otherwise Ctrl+C is the interrupt signal).
        if ((isMac && e.metaKey && key === 'KeyC') || (!isMac && e.ctrlKey && key === 'KeyC' && (e.shiftKey || term?.hasSelection()))) {
          if (term?.hasSelection()) {
            e.preventDefault()
            copySelection()
            if (!e.shiftKey) term.clearSelection()
          }
          return false
        }
        // Paste: Cmd+V, Ctrl+V, Ctrl+Shift+V. Handled here so the shell never receives a stray ^V.
        if (mod && key === 'KeyV') {
          e.preventDefault()
          void paste()
          return false
        }
        if ((isMac ? e.metaKey && !e.shiftKey : e.ctrlKey && e.shiftKey) && key === 'KeyF') {
          e.preventDefault()
          openFind()
          return false
        }
        return true
      })

      term.onData((d) => {
        if (idRef.current) remote.term.input(idRef.current, d)
      })
      term.onResize(({ cols, rows }) => {
        if (idRef.current) remote.term.resize(idRef.current, cols, rows)
      })
      term.onTitleChange(setTitle)
      term.onSelectionChange(() => {
        if (!settingsRef.current.copyOnSelect) return
        clearTimeout(selTimer)
        selTimer = setTimeout(() => term?.hasSelection() && copySelection(), 120)
      })

      ro = new ResizeObserver(() => requestAnimationFrame(fit))
      ro.observe(host.current)
      fit()
      setReady(true)
    }

    // Measure with the real font: wait (briefly) for the bundled web font before creating the terminal.
    const font = `${settingsRef.current.fontSize}px "JetBrains Mono"`
    void Promise.race([document.fonts.load(font), new Promise((r) => setTimeout(r, 1500))])
      .catch(() => undefined)
      .then(create)

    const wheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const cur = settingsRef.current.fontSize
      onSettingsRef.current({ fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, cur + (e.deltaY < 0 ? 1 : -1))) })
    }
    el.addEventListener('wheel', wheel, { passive: false })

    return () => {
      disposed = true
      clearTimeout(selTimer)
      el.removeEventListener('wheel', wheel)
      ro?.disconnect()
      term?.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
      setReady(false)
    }
    // The terminal is created once per pane; settings are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- (re)connect: one SSH session per `session` value
  useEffect(() => {
    const term = termRef.current
    if (!ready || !term) return
    const id = `t-${crypto.randomUUID()}`
    idRef.current = id
    let sentInitial = false
    setConn({ state: 'connecting' })
    const offData = remote.term.onData((i, d) => {
      if (i === id) term.write(d, () => remote.term.ack(id, d.length))
    })
    const offState = remote.term.onState((e) => {
      if (e.id !== id) return
      setConn({ state: e.state, error: e.error, code: e.code })
      onState?.(e.state)
      if (e.state === 'open') {
        fit()
        if (activeRef.current) term.focus()
        if (initialCommand && !sentInitial) {
          sentInitial = true
          remote.term.input(id, `${initialCommand}\r`)
        }
      }
    })
    onState?.('connecting')
    void remote.term.open(id, info.id, term.cols, term.rows).then((r) => {
      if (!r.ok && idRef.current === id) {
        setConn({ state: 'closed', error: r.error })
        onState?.('closed')
      }
    })
    return () => {
      offData()
      offState()
      remote.term.close(id)
      if (idRef.current === id) idRef.current = null
    }
    // initialCommand and onState are read when the session starts; changing them must not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, session, info.id, remote])

  // ---- apply look-and-feel changes live
  useEffect(() => {
    const term = termRef.current
    if (!ready || !term) return
    term.options.theme = getTerminalTheme(settings.theme).colors
    term.options.fontFamily = FONT_STACKS[settings.font]
    term.options.fontSize = settings.fontSize
    term.options.cursorStyle = settings.cursor
    term.options.cursorBlink = settings.cursorBlink
    term.options.scrollback = settings.scrollback
    requestAnimationFrame(fit)
  }, [ready, settings, fit])

  // ---- focus + refit when the tab becomes visible, or the side panel toggles
  useEffect(() => {
    if (!active || !ready) return
    const raf = requestAnimationFrame(() => {
      fit()
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [active, ready, appearance, fit])

  const reconnect = (): void => {
    termRef.current?.write(`\r\n\x1b[2m--- ${t('reconnecting')} ---\x1b[0m\r\n`)
    setSession((n) => n + 1)
  }

  const find = (dir: 'next' | 'prev', text = findText): void => {
    if (!text) return
    const s = searchRef.current
    if (dir === 'next') s?.findNext(text, { incremental: false })
    else s?.findPrevious(text)
  }

  const closeFind = (): void => {
    setFindOpen(false)
    searchRef.current?.clearDecorations()
    termRef.current?.focus()
  }

  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const term = termRef.current
    if (settings.rightClick === 'paste') {
      if (term?.hasSelection()) {
        copySelection()
        term.clearSelection()
      } else void paste()
      return
    }
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const hasSelection = !!termRef.current?.hasSelection()
  const mod = isMac ? '⌘' : 'Ctrl+'
  const menuItems: MenuItem[] = [
    {
      id: 'copy',
      label: t('Copy'),
      icon: <ClipboardCopy />,
      hint: isMac ? '⌘C' : 'Ctrl+Shift+C',
      disabled: !hasSelection,
      onSelect: copySelection
    },
    { id: 'paste', label: t('Paste'), icon: <ClipboardPaste />, hint: `${mod}${isMac ? '' : 'Shift+'}V`, onSelect: () => void paste() },
    { id: 'all', label: t('Select all'), separator: true, onSelect: () => termRef.current?.selectAll() },
    { id: 'find', label: t('Find'), icon: <Search />, hint: isMac ? '⌘F' : 'Ctrl+Shift+F', onSelect: openFind },
    { id: 'clear', label: t('Clear screen'), icon: <Eraser />, separator: true, onSelect: () => termRef.current?.clear() }
  ]

  const bg = getTerminalTheme(settings.theme).colors.background
  const stateColor = conn.state === 'open' ? 'bg-ok' : conn.state === 'connecting' ? 'bg-caution' : 'bg-bad'
  const stateLabel = conn.state === 'open' ? t('Connected') : conn.state === 'connecting' ? t('Connecting…') : t('Disconnected')

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-3 text-xs">
        <span
          className={cn('size-2 shrink-0 rounded-full', stateColor, conn.state === 'connecting' && 'animate-pulse')}
          title={stateLabel}
        />
        <span className="shrink-0 font-mono text-foreground">
          {info.username}@{info.host}
        </span>
        {title && <span className="min-w-0 truncate font-mono text-subtle">· {title}</span>}
        <span className="flex-1" />
        {conn.state === 'closed' && (
          <Button size="sm" variant="secondary" className="h-7 gap-1.5" onClick={reconnect}>
            <RefreshCw className="size-3.5" /> {t('Reconnect')}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-7" title={t('Find')} aria-label={t('Find')} onClick={openFind}>
          <Search />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" title={t('Copy')} aria-label={t('Copy')} onClick={copySelection}>
          <ClipboardCopy />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" title={t('Paste')} aria-label={t('Paste')} onClick={() => void paste()}>
          <ClipboardPaste />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={t('Clear screen')}
          aria-label={t('Clear screen')}
          onClick={() => termRef.current?.clear()}
        >
          <Eraser />
        </Button>
        {onOpenFiles && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title={t('Files (SFTP)')}
            aria-label={t('Files (SFTP)')}
            onClick={onOpenFiles}
          >
            <FolderOpen />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-7', appearance && 'bg-accent text-foreground')}
          title={t('Terminal appearance')}
          aria-label={t('Terminal appearance')}
          aria-pressed={appearance}
          onClick={() => setAppearance((v) => !v)}
        >
          <Palette />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1" style={{ background: bg }} onContextMenu={onContextMenu}>
          {/* The padding lives on a wrapper: FitAddon measures the inner box, so cols/rows never overflow it. */}
          <div className="absolute inset-0 p-2">
            <div ref={host} className="h-full w-full" />
          </div>

          {findOpen && (
            <div className="no-drag absolute right-4 top-2 z-10 flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-xl">
              <input
                ref={findInput}
                value={findText}
                placeholder={t('Find in terminal')}
                aria-label={t('Find in terminal')}
                onChange={(e) => {
                  setFindText(e.target.value)
                  if (e.target.value) searchRef.current?.findNext(e.target.value, { incremental: true })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') find(e.shiftKey ? 'prev' : 'next')
                  if (e.key === 'Escape') closeFind()
                }}
                className="no-drag h-7 w-44 select-text rounded-md bg-background px-2 text-xs text-foreground outline-none placeholder:text-subtle"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title={t('Previous match')}
                aria-label={t('Previous match')}
                onClick={() => find('prev')}
              >
                <ChevronUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title={t('Next match')}
                aria-label={t('Next match')}
                onClick={() => find('next')}
              >
                <ChevronDown />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" title={t('Close')} aria-label={t('Close')} onClick={closeFind}>
                <X />
              </Button>
            </div>
          )}

          {conn.state === 'connecting' && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
              <div className="flex items-center gap-2 rounded-full border border-border bg-popover/95 px-3 py-1.5 text-xs text-foreground shadow-lg">
                <Loader2 className="size-3.5 animate-spin" /> {t('Connecting to {name}…', { name: info.name })}
              </div>
            </div>
          )}
          {conn.state === 'closed' && (
            <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
              <div className="flex max-w-full items-center gap-3 rounded-lg border border-bad/40 bg-popover/95 px-3 py-2 text-xs shadow-lg">
                <span className="min-w-0 break-words text-bad">
                  {conn.error ? t(conn.error) : conn.code ? t('Session ended (exit code {code})', { code: conn.code }) : t('Session ended')}
                </span>
                <Button size="sm" variant="secondary" className="h-7 shrink-0 gap-1.5" onClick={reconnect}>
                  <RefreshCw className="size-3.5" /> {t('Reconnect')}
                </Button>
              </div>
            </div>
          )}
        </div>
        {appearance && <TerminalAppearance settings={settings} onChange={onSettings} onClose={() => setAppearance(false)} />}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  )
}
