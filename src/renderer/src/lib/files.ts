import type { SftpEntry, Transfer } from '@shared/remote'

export type SortKey = 'name' | 'size' | 'mtime'
export type SortDir = 'asc' | 'desc'

/** Folders, and symlinks that point to folders, open on double click. */
export const isDirLike = (e: SftpEntry): boolean => e.kind === 'dir' || (e.kind === 'link' && !!e.linkToDir)

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders always come first; inside each group the chosen column decides. */
export function sortEntries(list: SftpEntry[], key: SortKey, dir: SortDir): SftpEntry[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const da = isDirLike(a)
    const db = isDirLike(b)
    if (da !== db) return da ? -1 : 1
    const by = key === 'size' ? a.size - b.size : key === 'mtime' ? a.mtime - b.mtime : collator.compare(a.name, b.name)
    return by !== 0 ? sign * by : collator.compare(a.name, b.name)
  })
}

export function visibleEntries(list: SftpEntry[], opts: { query: string; showHidden: boolean }): SftpEntry[] {
  const q = opts.query.trim().toLowerCase()
  return list.filter((e) => (opts.showHidden || !e.name.startsWith('.')) && (!q || e.name.toLowerCase().includes(q)))
}

/** English error key (translated in the UI) or null when the name is fine. */
export function validFileName(name: string): string | null {
  if (!name.trim()) return 'Name is required'
  if (name === '.' || name === '..') return 'Invalid name'
  if (name.includes('/') || name.includes('\0')) return 'Names cannot contain "/"'
  if (name.length > 255) return 'Name is too long'
  return null
}

/** "755" / "0644" -> number, or null when it is not a valid octal permission string. */
export function parseOctalMode(s: string): number | null {
  const t = s.trim()
  if (!/^[0-7]{3,4}$/.test(t)) return null
  return parseInt(t, 8)
}

export const octalString = (mode: number): string => (mode & 0o7777).toString(8).padStart(3, '0')

/** Names between the anchor and the target (inclusive) in the order currently shown. */
export function selectRange(order: string[], anchor: string, target: string): string[] {
  const a = order.indexOf(anchor)
  const b = order.indexOf(target)
  if (a < 0 || b < 0) return [target]
  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}

/** File-manager style click selection: plain = just this one, Ctrl/Cmd = toggle, Shift = range from the anchor. */
export function clickSelect(
  current: ReadonlySet<string>,
  order: string[],
  anchor: string | null,
  name: string,
  mods: { ctrl: boolean; shift: boolean }
): { selected: Set<string>; anchor: string | null } {
  if (mods.shift && anchor) return { selected: new Set(selectRange(order, anchor, name)), anchor }
  if (mods.ctrl) {
    const next = new Set(current)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return { selected: next, anchor: name }
  }
  return { selected: new Set([name]), anchor: name }
}

/** Overall progress 0..1 of a transfer (folders are measured by bytes, so the bar never jumps backwards). */
export const transferProgress = (t: Pick<Transfer, 'done' | 'total' | 'state'>): number =>
  t.state === 'done' ? 1 : t.total > 0 ? Math.min(1, t.done / t.total) : 0
