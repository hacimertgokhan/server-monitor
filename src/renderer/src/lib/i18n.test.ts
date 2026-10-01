import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { hasTranslation, translate } from './i18n'

const SRC = join(__dirname, '..', '..', '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : []
  })
}

const sources = files(SRC).filter((f) => !f.endsWith('i18n.tsx'))
const catalogue = readFileSync(join(__dirname, 'i18n.tsx'), 'utf8')

/** Every English literal passed to t('...') in the renderer. */
const used = new Set<string>()
for (const f of sources.filter((p) => p.includes(join('src', 'renderer')))) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) used.add(m[1].replace(/\\'/g, "'"))
}

/**
 * Labels that reach t() through a variable (t(title), t(CAP_LABEL[k]) ...) are declared as `title|text|label: '...'`
 * or as values of a lookup object; collect every quoted string of those declarations so they are checked as well.
 */
const dynamicFiles = ['mcp-policy.tsx', 'mcp-agents.tsx', 'mcp-activity.tsx']
const dynamic = new Set<string>()
for (const f of sources.filter((p) => dynamicFiles.some((d) => p.endsWith(d)))) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(/\b(?:title|text|label|read|logs|exec): '((?:[^'\\]|\\.)*)'/g)) dynamic.add(m[1].replace(/\\'/g, "'"))
}

/** Every quoted string anywhere in the renderer: a catalogue entry is "in use" if its text appears in the code. */
const literals = new Set<string>()
for (const f of sources.filter((p) => p.includes(join('src', 'renderer')))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) literals.add(m[1].replace(/\\'/g, "'"))
}

// Error strings produced by the main process and translated in the renderer via t(error).
const mainErrors = ['monitor.ts', 'store.ts', 'mcp-store.ts', 'ssh-connect.ts', 'sftp.ts', 'terminal.ts'].flatMap((f) =>
  [...readFileSync(join(SRC, 'main', f), 'utf8').matchAll(/'([A-Z][^'\n]* [^'\n]*)'/g)].map((m) => m[1])
)

describe('i18n catalogue', () => {
  it('has a Turkish translation for every string used in the UI', () => {
    const missing = [...used].filter((k) => !hasTranslation('tr', k))
    expect(missing).toEqual([])
  })

  it('has a Turkish translation for labels that reach t() through variables', () => {
    expect(dynamic.size).toBeGreaterThan(10)
    const missing = [...dynamic].filter((k) => !hasTranslation('tr', k))
    expect(missing).toEqual([])
  })

  it('has a Turkish translation for every main-process error message', () => {
    const missing = mainErrors.filter((k) => !hasTranslation('tr', k))
    expect(missing).toEqual([])
  })

  it('has no stale entries that nothing uses', () => {
    const keys = [...catalogue.matchAll(/^ {2}'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1].replace(/\\'/g, "'"))
    const known = new Set([...used, ...dynamic, ...literals, ...mainErrors])
    expect(keys.filter((k) => !known.has(k))).toEqual([])
  })

  it('interpolates variables', () => {
    expect(translate('tr', '{online}/{total} online', { online: 2, total: 5 })).toBe('2/5 çevrimiçi')
    expect(translate('en', '{n} cores', { n: 4 })).toBe('4 cores')
  })
})
