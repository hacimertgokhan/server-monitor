import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Home,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  SquareTerminal,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { modeString, posix } from '@shared/remote'
import type { SftpEntry, SftpListing, Transfer } from '@shared/remote'
import type { ServerInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ContextMenu } from '@/components/ui/context-menu'
import type { MenuItem } from '@/components/ui/context-menu'
import { clickSelect, isDirLike, sortEntries, transferProgress, visibleEntries } from '@/lib/files'
import type { SortDir, SortKey } from '@/lib/files'
import { useI18n } from '@/lib/i18n'
import type { Remote } from '@/lib/remote'
import { cn, formatBytes } from '@/lib/utils'
import { ConfirmDialog, NameDialog, PermissionsDialog } from './file-dialogs'
import { FileEditor } from './file-editor'

interface Props {
  info: ServerInfo
  remote: Remote
  /** Transfers of this server (newest first). */
  transfers: Transfer[]
  onDismissTransfer: (id: string) => void
  onClearFinished: () => void
  /** Opens a terminal tab and `cd`s into the folder. */
  onOpenTerminalHere?: (path: string) => void
  /** Folder to show first (default: the home directory). */
  startPath?: string
}

type Dialog = 'mkdir' | 'create' | 'rename' | 'delete' | 'chmod' | null
type Notice = { kind: 'error' | 'info'; text: string } | null

const MAX_ROWS = 2000
const GRID = 'grid-cols-[minmax(0,1fr)_84px_136px] lg:grid-cols-[minmax(0,1fr)_84px_136px_92px]'
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i
const ARCHIVE = /\.(zip|tar|gz|tgz|bz2|xz|7z|rar|zst)$/i
const CODE = /\.(js|jsx|ts|tsx|json|ya?ml|toml|py|rb|go|rs|java|c|h|cpp|cs|php|sh|bash|sql|html|css|scss|vue|conf|ini|env|service)$/i
const TEXT = /\.(txt|md|log|csv|cfg|rst)$/i

function EntryIcon({ e }: { e: SftpEntry }) {
  const cls = 'size-4 shrink-0'
  if (isDirLike(e)) return <Folder className={cn(cls, 'text-info')} />
  if (e.kind === 'link') return <Link2 className={cn(cls, 'text-muted-foreground')} />
  if (IMAGE.test(e.name)) return <FileImage className={cn(cls, 'text-[#b394c9]')} />
  if (ARCHIVE.test(e.name)) return <FileArchive className={cn(cls, 'text-caution')} />
  if (CODE.test(e.name)) return <FileCode className={cn(cls, 'text-ok')} />
  if (TEXT.test(e.name)) return <FileText className={cn(cls, 'text-muted-foreground')} />
  return <FileIcon className={cn(cls, 'text-muted-foreground')} />
}

const typeChar = (e: SftpEntry): string => (e.kind === 'dir' ? 'd' : e.kind === 'link' ? 'l' : '-')

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; dir: SortDir }
  onSort: (k: SortKey) => void
  className?: string
}) {
  const on = sort.key === k
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(
        'no-drag flex items-center gap-1 px-3 py-2 text-left font-medium transition-colors hover:text-foreground',
        on && 'text-foreground',
        className
      )}
    >
      {label}
      {on && (sort.dir === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
    </button>
  )
}

export function FilesPane({ info, remote, transfers, onDismissTransfer, onClearFinished, onOpenTerminalHere, startPath }: Props) {
  const { t, locale } = useI18n()
  const [listing, setListing] = useState<SftpListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' })
  const [editing, setEditing] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [editPath, setEditPath] = useState<string | null>(null)
  const anchor = useRef<string | null>(null)
  const seq = useRef(0)
  const table = useRef<HTMLDivElement>(null)
  const crumbs = useRef<HTMLDivElement>(null)

  const path = listing?.path ?? null
  const fmtDate = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale])

  const load = useCallback(
    async (target: string | null, keepSelection = false): Promise<void> => {
      const mine = ++seq.current
      setLoading(true)
      const r = await remote.sftp.list(info.id, target)
      if (mine !== seq.current) return // a newer navigation superseded this one
      setLoading(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setError('')
      setListing(r.data)
      if (!keepSelection) {
        setSelected(new Set())
        anchor.current = null
      }
    },
    [remote, info.id]
  )

  // First load, and again if the tab is pointed at another server.
  useEffect(() => {
    setListing(null)
    void load(startPath ?? null)
    const counter = seq
    return () => {
      counter.current++
    }
    // startPath only matters for the very first listing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // Refresh when an upload into the folder we are looking at finishes.
  const finishedUploads = transfers.filter((x) => x.direction === 'up' && x.state === 'done' && x.target === path).length
  const lastFinished = useRef(finishedUploads)
  useEffect(() => {
    if (finishedUploads > lastFinished.current) void load(path, true)
    lastFinished.current = finishedUploads
  }, [finishedUploads, path, load])

  useEffect(() => {
    crumbs.current?.scrollTo({ left: crumbs.current.scrollWidth })
  }, [path])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 7000)
    return () => clearTimeout(id)
  }, [notice])

  const rows = useMemo(
    () => sortEntries(visibleEntries(listing?.entries ?? [], { query, showHidden }), sort.key, sort.dir),
    [listing, query, showHidden, sort]
  )
  const shown = rows.slice(0, MAX_ROWS)
  const order = useMemo(() => shown.map((r) => r.name), [shown])
  const picked = rows.filter((r) => selected.has(r.name))
  const one = picked.length === 1 ? picked[0] : null
  const full = (name: string): string => posix.join(path ?? '/', name)

  const fail = (msg: string): void => setNotice({ kind: 'error', text: msg })

  /** Runs a mutation, refreshes the listing and shows the error if it failed. */
  const mutate = async (op: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> => {
    const r = await op()
    if (!r.ok) {
      fail(r.error ?? 'Operation failed (does it already exist?)')
      return false
    }
    await load(path, true)
    return true
  }

  const download = async (names: string[]): Promise<void> => {
    if (names.length === 0) return
    const r = await remote.sftp.download(info.id, names.map(full))
    if (!r.ok) fail(r.error)
  }

  const upload = async (kind: 'files' | 'folder'): Promise<void> => {
    if (!path) return
    const r = await remote.sftp.uploadPick(info.id, path, kind)
    if (!r.ok) fail(r.error)
  }

  const open = (e: SftpEntry): void => {
    if (isDirLike(e)) return void load(full(e.name))
    if (e.size > 2 * 1024 * 1024) return void download([e.name])
    setEditing(full(e.name))
  }

  const sortBy = (key: SortKey): void =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  const onRowClick = (e: MouseEvent, name: string): void => {
    const r = clickSelect(selected, order, anchor.current, name, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
    setSelected(r.selected)
    anchor.current = r.anchor
  }

  const onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (e.key === 'Delete' && picked.length) setDialog('delete')
    else if (e.key === 'F2' && one) setDialog('rename')
    else if (e.key === 'F5') void load(path, true)
    else if (e.key === 'Enter' && one) open(one)
    else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) {
      if (path && path !== '/') void load(posix.dirname(path))
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelected(new Set(order))
    } else if (e.key === 'Escape') setSelected(new Set())
    else return
    e.preventDefault()
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    if (!path) return
    const paths = [...e.dataTransfer.files].map((f) => remote.sftp.pathForFile(f)).filter(Boolean)
    if (paths.length === 0) return
    void remote.sftp.upload(info.id, path, paths).then((r) => !r.ok && fail(r.error))
  }
  const isFileDrag = (e: DragEvent): boolean => [...e.dataTransfer.types].includes('Files')

  const copyPath = (p: string): void => {
    void remote.clipboard.writeText(p)
    setNotice({ kind: 'info', text: t('Copied: {path}', { path: p }) })
  }

  const menuItems = (): MenuItem[] => {
    const items: MenuItem[] = []
    if (one) {
      items.push({
        id: 'open',
        label: isDirLike(one) ? t('Open') : t('Edit'),
        icon: isDirLike(one) ? <FolderOpen /> : <Pencil />,
        onSelect: () => open(one)
      })
    }
    if (picked.length) {
      items.push({ id: 'dl', label: t('Download'), icon: <Download />, onSelect: () => void download(picked.map((p) => p.name)) })
    }
    if (one) {
      items.push({ id: 'rename', label: t('Rename'), icon: <Pencil />, hint: 'F2', onSelect: () => setDialog('rename') })
      items.push({ id: 'chmod', label: t('Permissions'), icon: <KeyRound />, onSelect: () => setDialog('chmod') })
      items.push({ id: 'copy', label: t('Copy path'), icon: <Copy />, onSelect: () => copyPath(full(one.name)) })
    }
    if (onOpenTerminalHere && path) {
      const target = one && isDirLike(one) ? full(one.name) : path
      items.push({
        id: 'term',
        label: t('Open terminal here'),
        icon: <SquareTerminal />,
        separator: picked.length > 0,
        onSelect: () => onOpenTerminalHere(target)
      })
    }
    items.push({ id: 'mkdir', label: t('New folder'), icon: <FolderPlus />, separator: true, onSelect: () => setDialog('mkdir') })
    items.push({ id: 'create', label: t('New file'), icon: <FilePlus />, onSelect: () => setDialog('create') })
    items.push({ id: 'up', label: t('Upload files'), icon: <Upload />, onSelect: () => void upload('files') })
    items.push({ id: 'refresh', label: t('Refresh'), icon: <RefreshCw />, hint: 'F5', onSelect: () => void load(path, true) })
    if (picked.length) {
      items.push({
        id: 'del',
        label: t('Delete'),
        icon: <Trash2 />,
        hint: 'Del',
        danger: true,
        separator: true,
        onSelect: () => setDialog('delete')
      })
    }
    return items
  }

  const running = transfers.filter((x) => x.state === 'running').length
  const finished = transfers.length - running

  return (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-col bg-background"
      onDragEnter={(e) => isFileDrag(e) && setDragging(true)}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={onDrop}
    >
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={!path || path === '/'}
          title={t('Parent folder')}
          aria-label={t('Parent folder')}
          onClick={() => path && void load(posix.dirname(path))}
        >
          <FolderUp />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={t('Home folder')}
          aria-label={t('Home folder')}
          onClick={() => void load(null)}
        >
          <Home />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title={t('Refresh')}
          aria-label={t('Refresh')}
          onClick={() => void load(path, true)}
        >
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>

        {editPath !== null ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault()
              const p = editPath.trim()
              setEditPath(null)
              if (p) void load(p)
            }}
          >
            <input
              autoFocus
              value={editPath}
              aria-label={t('Path')}
              onChange={(e) => setEditPath(e.target.value)}
              onBlur={() => setEditPath(null)}
              onKeyDown={(e) => e.key === 'Escape' && setEditPath(null)}
              className="no-drag h-7 w-full select-text rounded-md border border-ring bg-card px-2 font-mono text-xs text-foreground outline-none"
            />
          </form>
        ) : (
          <div
            ref={crumbs}
            className="no-drag flex h-7 min-w-0 flex-1 cursor-text items-center overflow-x-auto rounded-md border border-border bg-card px-1 font-mono text-xs [scrollbar-width:none]"
            onDoubleClick={() => setEditPath(path ?? '')}
            title={t('Double-click to type a path')}
          >
            {path === null ? (
              <span className="px-1.5 text-subtle">…</span>
            ) : (
              posix.trail(path).map((p, i, all) => (
                <span key={p} className="flex shrink-0 items-center">
                  {i > 0 && <ChevronRight className="size-3 text-subtle" />}
                  <button
                    type="button"
                    onClick={() => void load(p)}
                    className={cn(
                      'rounded px-1.5 py-0.5 hover:bg-accent',
                      i === all.length - 1 ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {p === '/' ? '/' : posix.basename(p)}
                  </button>
                </span>
              ))
            )}
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={!path}
          title={t('New folder')}
          aria-label={t('New folder')}
          onClick={() => setDialog('mkdir')}
        >
          <FolderPlus />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={!path}
          title={t('New file')}
          aria-label={t('New file')}
          onClick={() => setDialog('create')}
        >
          <FilePlus />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={!path}
          title={t('Upload files')}
          aria-label={t('Upload files')}
          onClick={() => void upload('files')}
        >
          <Upload />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={!path}
          title={t('Upload folder')}
          aria-label={t('Upload folder')}
          onClick={() => void upload('folder')}
        >
          <ArrowUpFromLine />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={picked.length === 0}
          title={t('Download')}
          aria-label={t('Download')}
          onClick={() => void download(picked.map((p) => p.name))}
        >
          <Download />
        </Button>
        {onOpenTerminalHere && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={!path}
            title={t('Open terminal here')}
            aria-label={t('Open terminal here')}
            onClick={() => path && onOpenTerminalHere(path)}
          >
            <SquareTerminal />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-7', showHidden && 'bg-accent text-foreground')}
          title={showHidden ? t('Hide hidden files') : t('Show hidden files')}
          aria-label={showHidden ? t('Hide hidden files') : t('Show hidden files')}
          aria-pressed={showHidden}
          onClick={() => setShowHidden((v) => !v)}
        >
          {showHidden ? <Eye /> : <EyeOff />}
        </Button>
        <label className="no-drag relative hidden items-center xl:flex">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Filter')}
            aria-label={t('Filter')}
            className="no-drag h-7 w-32 select-text rounded-md border border-input bg-background pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-subtle focus-visible:border-ring"
          />
        </label>
      </div>

      {notice && (
        <div
          role="status"
          className={cn(
            'flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs',
            notice.kind === 'error' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-border bg-card text-muted-foreground'
          )}
        >
          <span className="min-w-0 flex-1 break-words">{notice.kind === 'error' ? t(notice.text) : notice.text}</span>
          <button
            type="button"
            className="no-drag shrink-0 opacity-70 hover:opacity-100"
            aria-label={t('Close')}
            onClick={() => setNotice(null)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* listing */}
      <div
        ref={table}
        tabIndex={0}
        role="grid"
        aria-label={t('Files')}
        aria-busy={loading}
        onKeyDown={onKey}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onMouseDown={(e) => e.target === e.currentTarget && setSelected(new Set())}
        className="relative min-h-0 flex-1 select-none overflow-auto outline-none"
      >
        <div
          className={cn(
            'sticky top-0 z-10 grid border-b border-border bg-background text-[11.5px] uppercase tracking-wider text-muted-foreground',
            GRID
          )}
        >
          <SortHeader label={t('Name')} k="name" sort={sort} onSort={sortBy} />
          <SortHeader label={t('Size')} k="size" sort={sort} onSort={sortBy} className="justify-end text-right" />
          <SortHeader label={t('Modified')} k="mtime" sort={sort} onSort={sortBy} />
          <span className="hidden px-3 py-2 font-medium lg:block">{t('Permissions')}</span>
        </div>

        {error && !listing && (
          <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 px-4 text-center">
            <p className="break-words text-sm text-bad">{t(error)}</p>
            <Button size="sm" variant="secondary" onClick={() => void load(startPath ?? null)}>
              <RefreshCw /> {t('Retry')}
            </Button>
          </div>
        )}
        {error && listing && <div className="border-b border-bad/30 bg-bad/10 px-3 py-1.5 text-xs text-bad">{t(error)}</div>}
        {loading && !listing && !error && (
          <div className="flex justify-center pt-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}

        {listing && shown.length === 0 && !error && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {query ? t('No files match your filter') : t('This folder is empty')}
          </p>
        )}

        {shown.map((e) => {
          const on = selected.has(e.name)
          return (
            <div
              key={e.name}
              role="row"
              aria-selected={on}
              onClick={(ev) => onRowClick(ev, e.name)}
              onDoubleClick={() => open(e)}
              onContextMenu={(ev) => {
                ev.stopPropagation()
                ev.preventDefault()
                if (!on) {
                  setSelected(new Set([e.name]))
                  anchor.current = e.name
                }
                setMenu({ x: ev.clientX, y: ev.clientY })
              }}
              className={cn(
                'grid cursor-default items-center border-b border-border/40 text-[13px]',
                GRID,
                on ? 'bg-accent text-foreground' : 'text-foreground hover:bg-muted'
              )}
            >
              <span className="flex min-w-0 items-center gap-2 px-3 py-1.5">
                <EntryIcon e={e} />
                <span className={cn('truncate', e.name.startsWith('.') && 'text-muted-foreground')} title={e.name}>
                  {e.name}
                </span>
                {e.kind === 'link' && <span className="shrink-0 text-[11px] text-subtle">{t('link')}</span>}
              </span>
              <span className="px-3 text-right font-mono text-xs text-muted-foreground">{isDirLike(e) ? '–' : formatBytes(e.size)}</span>
              <span className="truncate px-3 text-xs text-muted-foreground">{e.mtime ? fmtDate.format(e.mtime) : '–'}</span>
              <span className="hidden px-3 font-mono text-[11.5px] text-subtle lg:block">
                {typeChar(e)}
                {modeString(e.mode)}
              </span>
            </div>
          )
        })}
        {rows.length > MAX_ROWS && (
          <p className="px-3 py-2 text-center text-xs text-subtle">
            {t('Showing the first {n} items. Use the filter to narrow down.', { n: MAX_ROWS })}
          </p>
        )}
      </div>

      {/* transfers */}
      {transfers.length > 0 && (
        <div className="max-h-44 shrink-0 overflow-auto border-t border-border bg-card">
          <div className="sticky top-0 flex items-center justify-between bg-card px-3 py-1.5 text-[11.5px] uppercase tracking-wider text-muted-foreground">
            <span>
              {t('Transfers')} {running > 0 && <span className="text-foreground">· {t('{n} running', { n: running })}</span>}
            </span>
            {finished > 0 && (
              <button type="button" className="no-drag normal-case tracking-normal hover:text-foreground" onClick={onClearFinished}>
                {t('Clear finished')}
              </button>
            )}
          </div>
          {transfers.map((x) => (
            <div key={x.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              {x.direction === 'up' ? (
                <ArrowUp className="size-3.5 shrink-0 text-info" />
              ) : (
                <ArrowDown className="size-3.5 shrink-0 text-ok" />
              )}
              <span className="w-40 shrink-0 truncate font-mono text-foreground" title={x.name}>
                {x.name}
              </span>
              <div className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width]',
                    x.state === 'error' ? 'bg-bad' : x.state === 'cancelled' ? 'bg-dim' : 'bg-ok'
                  )}
                  style={{ width: `${Math.round(transferProgress(x) * 100)}%` }}
                />
              </div>
              <span className="w-32 shrink-0 text-right font-mono text-muted-foreground">
                {x.state === 'running' || x.state === 'done' ? `${formatBytes(x.done)} / ${formatBytes(x.total)}` : ''}
                {x.state === 'error' && <span className="text-bad">{t(x.error ?? 'Operation failed (does it already exist?)')}</span>}
                {x.state === 'cancelled' && t('Cancelled')}
              </span>
              <button
                type="button"
                className="no-drag shrink-0 text-muted-foreground hover:text-foreground"
                title={x.state === 'running' ? t('Cancel') : t('Dismiss')}
                aria-label={x.state === 'running' ? t('Cancel') : t('Dismiss')}
                onClick={() => (x.state === 'running' ? remote.sftp.cancel(x.id) : onDismissTransfer(x.id))}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border px-3 text-[11.5px] text-subtle">
        <span>{t('{n} items', { n: rows.length })}</span>
        {picked.length > 0 && <span>{t('{n} selected', { n: picked.length })}</span>}
        <span className="flex-1" />
        <span className="truncate font-mono">
          {info.username}@{info.host}
        </span>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-foreground/50 bg-background/80">
          <div className="flex flex-col items-center gap-2 text-foreground">
            <Upload className="size-8" />
            <span className="text-sm">{t('Drop to upload to {path}', { path: path ?? '/' })}</span>
          </div>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}

      <NameDialog
        open={dialog === 'mkdir'}
        title={t('New folder')}
        initial=""
        confirm={t('Create')}
        onClose={() => setDialog(null)}
        onSubmit={(name) => {
          setDialog(null)
          void mutate(() => remote.sftp.mkdir(info.id, full(name)))
        }}
      />
      <NameDialog
        open={dialog === 'create'}
        title={t('New file')}
        initial=""
        confirm={t('Create')}
        onClose={() => setDialog(null)}
        onSubmit={(name) => {
          setDialog(null)
          void mutate(() => remote.sftp.create(info.id, full(name))).then((ok) => ok && setEditing(full(name)))
        }}
      />
      <NameDialog
        open={dialog === 'rename' && !!one}
        title={t('Rename')}
        initial={one?.name ?? ''}
        confirm={t('Rename')}
        onClose={() => setDialog(null)}
        onSubmit={(name) => {
          setDialog(null)
          if (one && name !== one.name) void mutate(() => remote.sftp.rename(info.id, full(one.name), full(name)))
        }}
      />
      <PermissionsDialog
        open={dialog === 'chmod' && !!one}
        name={one ? full(one.name) : ''}
        mode={one?.mode ?? 0o644}
        onClose={() => setDialog(null)}
        onSubmit={(mode) => {
          setDialog(null)
          if (one) void mutate(() => remote.sftp.chmod(info.id, full(one.name), mode))
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete' && picked.length > 0}
        title={one ? t('Delete "{name}"?', { name: one.name }) : t('Delete {n} items?', { n: picked.length })}
        description={t('This cannot be undone. Folders are deleted with everything inside them.')}
        items={picked.map((p) => full(p.name) + (isDirLike(p) ? '/' : ''))}
        confirm={t('Delete')}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null)
          const paths = picked.map((p) => full(p.name))
          void mutate(() => remote.sftp.remove(info.id, paths))
        }}
      />
      <FileEditor
        serverId={info.id}
        path={editing}
        remote={remote}
        onClose={() => setEditing(null)}
        onSaved={() => void load(path, true)}
        onError={(m) =>
          setNotice({
            kind: 'error',
            text: m
          })
        }
      />
    </div>
  )
}
