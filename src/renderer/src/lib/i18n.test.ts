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

// Error strings produced by the main process and translated in the renderer via t(error).
const mainErrors = [...readFileSync(join(SRC, 'main', 'monitor.ts'), 'utf8').matchAll(/'([A-Z][^'\n]* [^'\n]*)'/g)].map((m) => m[1])

describe('i18n catalogue', () => {
  it('has a Turkish translation for every string used in the UI', () => {
    const missing = [...used].filter((k) => !hasTranslation('tr', k))
    expect(missing).toEqual([])
  })

  it('has a Turkish translation for every main-process error message', () => {
    const missing = mainErrors.filter((k) => !hasTranslation('tr', k))
    expect(missing).toEqual([])
  })

  it('has no stale entries that nothing uses', () => {
    const keys = [...catalogue.matchAll(/^ {2}'((?:[^'\\]|\\.)*)':/gm)].map((m) => m[1].replace(/\\'/g, "'"))
    const known = new Set([...used, ...mainErrors])
    expect(keys.filter((k) => !known.has(k))).toEqual([])
  })

  it('interpolates variables', () => {
    expect(translate('tr', '{online}/{total} online', { online: 2, total: 5 })).toBe('2/5 çevrimiçi')
    expect(translate('en', '{n} cores', { n: 4 })).toBe('4 cores')
  })
})
