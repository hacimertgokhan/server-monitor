import { describe, expect, it } from 'vitest'
import type { SftpEntry } from '@shared/remote'
import {
  clickSelect,
  octalString,
  parseOctalMode,
  selectRange,
  sortEntries,
  transferProgress,
  validFileName,
  visibleEntries
} from './files'

const e = (name: string, over: Partial<SftpEntry> = {}): SftpEntry => ({
  name,
  kind: 'file',
  size: 0,
  mtime: 0,
  mode: 0o644,
  uid: 0,
  gid: 0,
  ...over
})

describe('sortEntries', () => {
  const list = [
    e('b.txt', { size: 5, mtime: 30 }),
    e('a.txt', { size: 50, mtime: 10 }),
    e('zeta', { kind: 'dir' }),
    e('alpha', { kind: 'dir' }),
    e('link-to-dir', { kind: 'link', linkToDir: true }),
    e('link-to-file', { kind: 'link' }),
    e('file10.log'),
    e('file9.log')
  ]

  it('puts folders (and links to folders) first, then sorts by name with natural numbers', () => {
    const names = sortEntries(list, 'name', 'asc').map((x) => x.name)
    expect(names.slice(0, 3)).toEqual(['alpha', 'link-to-dir', 'zeta'])
    expect(names.indexOf('file9.log')).toBeLessThan(names.indexOf('file10.log'))
  })

  it('keeps folders first even when sorting descending', () => {
    const names = sortEntries(list, 'name', 'desc').map((x) => x.name)
    expect(names.slice(0, 3)).toEqual(['zeta', 'link-to-dir', 'alpha'])
  })

  it('sorts by size and by modification time inside the file group', () => {
    const files = (key: 'size' | 'mtime', dir: 'asc' | 'desc'): string[] =>
      sortEntries(
        [e('b.txt', { size: 5, mtime: 30 }), e('a.txt', { size: 50, mtime: 10 }), e('c.txt', { size: 20, mtime: 20 })],
        key,
        dir
      ).map((x) => x.name)
    expect(files('size', 'asc')).toEqual(['b.txt', 'c.txt', 'a.txt'])
    expect(files('mtime', 'desc')).toEqual(['b.txt', 'c.txt', 'a.txt'])
  })

  it('does not mutate its input', () => {
    const copy = [...list]
    sortEntries(list, 'size', 'desc')
    expect(list).toEqual(copy)
  })
})

describe('visibleEntries', () => {
  const list = [e('.bashrc'), e('Notes.txt'), e('app.log')]
  it('hides dotfiles unless asked and filters case-insensitively', () => {
    expect(visibleEntries(list, { query: '', showHidden: false }).map((x) => x.name)).toEqual(['Notes.txt', 'app.log'])
    expect(visibleEntries(list, { query: '', showHidden: true })).toHaveLength(3)
    expect(visibleEntries(list, { query: 'NOTES', showHidden: false }).map((x) => x.name)).toEqual(['Notes.txt'])
    expect(visibleEntries(list, { query: 'bash', showHidden: false })).toEqual([])
  })
})

describe('validFileName', () => {
  it('accepts normal names, including spaces, dots and unicode', () => {
    for (const n of ['a', 'my file.txt', '.env', 'dünya ğ.txt', '...']) expect(validFileName(n)).toBeNull()
  })
  it('rejects empty names, dot entries, slashes and overlong names', () => {
    expect(validFileName('')).toBe('Name is required')
    expect(validFileName('   ')).toBe('Name is required')
    expect(validFileName('.')).toBe('Invalid name')
    expect(validFileName('..')).toBe('Invalid name')
    expect(validFileName('a/b')).toBe('Names cannot contain "/"')
    expect(validFileName('x'.repeat(256))).toBe('Name is too long')
  })
})

describe('permissions', () => {
  it('parses octal strings and rejects everything else', () => {
    expect(parseOctalMode('755')).toBe(0o755)
    expect(parseOctalMode(' 0644 ')).toBe(0o644)
    expect(parseOctalMode('4755')).toBe(0o4755)
    for (const bad of ['', '75', '888', 'rwx', '12345', '-1']) expect(parseOctalMode(bad)).toBeNull()
  })
  it('formats modes as zero-padded octal', () => {
    expect(octalString(0o755)).toBe('755')
    expect(octalString(0o100644)).toBe('644')
    expect(octalString(0o7)).toBe('007')
  })
})

describe('selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  it('selectRange is inclusive and direction independent', () => {
    expect(selectRange(order, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(selectRange(order, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(selectRange(order, 'zz', 'c')).toEqual(['c'])
  })
  it('plain click selects one, ctrl toggles, shift extends from the anchor', () => {
    let r = clickSelect(new Set(), order, null, 'b', { ctrl: false, shift: false })
    expect([...r.selected]).toEqual(['b'])
    r = clickSelect(r.selected, order, r.anchor, 'd', { ctrl: true, shift: false })
    expect([...r.selected].sort()).toEqual(['b', 'd'])
    r = clickSelect(r.selected, order, r.anchor, 'b', { ctrl: true, shift: false })
    expect([...r.selected]).toEqual(['d'])
    r = clickSelect(new Set(['a']), order, 'a', 'c', { ctrl: false, shift: true })
    expect([...r.selected]).toEqual(['a', 'b', 'c'])
    expect(r.anchor).toBe('a')
  })
  it('shift without an anchor behaves like a plain click', () => {
    const r = clickSelect(new Set(), order, null, 'c', { ctrl: false, shift: true })
    expect([...r.selected]).toEqual(['c'])
  })
})

describe('transferProgress', () => {
  it('is a 0..1 fraction, 1 when done, 0 while the size is unknown', () => {
    expect(transferProgress({ done: 50, total: 200, state: 'running' })).toBe(0.25)
    expect(transferProgress({ done: 0, total: 0, state: 'running' })).toBe(0)
    expect(transferProgress({ done: 0, total: 0, state: 'done' })).toBe(1)
    expect(transferProgress({ done: 300, total: 200, state: 'running' })).toBe(1)
  })
})
