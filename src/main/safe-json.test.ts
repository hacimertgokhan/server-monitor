import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SafeJson } from './safe-json'

let dir: string
let sleeps: number[]
let logs: string[]
let store: SafeJson

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm-safe-'))
  sleeps = []
  logs = []
  store = new SafeJson(() => dir, { sleep: (ms) => void sleeps.push(ms), log: (m) => void logs.push(m) })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const file = (n: string): string => join(dir, n)

describe('SafeJson.read', () => {
  it('returns the fallback on a first run without flagging a problem', () => {
    expect(store.read('servers.json', [])).toEqual([])
    expect(store.problems.size).toBe(0)
    expect(logs).toEqual([])
  })

  it('reads a valid file', () => {
    writeFileSync(file('servers.json'), JSON.stringify([{ name: 'a' }]))
    expect(store.read('servers.json', [])).toEqual([{ name: 'a' }])
  })

  it('retries an unreadable file with growing pauses, then protects it instead of treating it as empty', () => {
    // A directory where the file should be: readFileSync fails with EISDIR, like a locked file would fail.
    mkdirSync(file('servers.json'))
    expect(store.read('servers.json', ['fallback'])).toEqual(['fallback'])
    expect(sleeps).toEqual([150, 300, 450, 600, 750]) // 6 attempts, no pause after the last one
    expect(store.problems.has('servers.json')).toBe(true)
    expect(logs.some((l) => l.includes('left untouched'))).toBe(true)
  })

  it('succeeds when the file becomes readable on a later attempt', () => {
    writeFileSync(file('settings.json'), '{"a":1}')
    let calls = 0
    const flaky = new SafeJson(() => dir, {
      log: () => undefined,
      sleep: () => {
        calls++
      }
    })
    // First attempt hits a directory, then we swap in the real file during the first pause.
    rmSync(file('settings.json'))
    mkdirSync(file('settings.json'))
    const restoring = new SafeJson(() => dir, {
      log: () => undefined,
      sleep: () => {
        if (calls++ === 0) {
          rmSync(file('settings.json'), { recursive: true })
          writeFileSync(file('settings.json'), '{"a":2}')
        }
      }
    })
    expect(restoring.read('settings.json', {})).toEqual({ a: 2 })
    expect(restoring.problems.size).toBe(0)
    expect(flaky).toBeDefined()
  })

  it('does not wait for damaged JSON (waiting cannot fix it) and restores the backup if there is one', () => {
    writeFileSync(file('servers.json'), '{ "broken": ')
    writeFileSync(file('servers.json.bak'), JSON.stringify([{ name: 'safe' }]))
    expect(store.read('servers.json', [])).toEqual([{ name: 'safe' }])
    expect(sleeps).toEqual([])
    expect(store.problems.size).toBe(0)
  })

  it('protects damaged JSON that has no backup', () => {
    writeFileSync(file('servers.json'), 'not json')
    expect(store.read('servers.json', [])).toEqual([])
    expect(store.problems.has('servers.json')).toBe(true)
    expect(readFileSync(file('servers.json'), 'utf8')).toBe('not json')
  })

  it('restores from the backup when the file itself has disappeared', () => {
    writeFileSync(file('settings.json.bak'), '{"layout":"grid"}')
    expect(store.read('settings.json', {})).toEqual({ layout: 'grid' })
  })
})

describe('SafeJson.write', () => {
  it('writes atomically and keeps the previous good version as .bak', () => {
    expect(store.write('servers.json', [1])).toBe(true)
    expect(existsSync(file('servers.json.bak'))).toBe(false) // nothing to back up yet
    store.write('servers.json', [1, 2])
    expect(JSON.parse(readFileSync(file('servers.json'), 'utf8'))).toEqual([1, 2])
    expect(JSON.parse(readFileSync(file('servers.json.bak'), 'utf8'))).toEqual([1])
    expect(existsSync(file('servers.json.tmp'))).toBe(false)
  })

  it('never replaces a good backup with a damaged file', () => {
    store.write('servers.json', ['good'])
    store.write('servers.json', ['newer']) // bak = good
    writeFileSync(file('servers.json'), '{ damaged')
    store.write('servers.json', ['latest'])
    expect(JSON.parse(readFileSync(file('servers.json.bak'), 'utf8'))).toEqual(['good'])
  })

  it('refuses to overwrite a file that could not be read, until the problem is cleared', () => {
    writeFileSync(file('servers.json'), 'precious but unreadable')
    store.read('servers.json', [])
    expect(store.write('servers.json', [])).toBe(false)
    expect(readFileSync(file('servers.json'), 'utf8')).toBe('precious but unreadable')
    store.clearProblems()
    expect(store.write('servers.json', ['now ok'])).toBe(true)
  })

  it('skips the backup when asked (frequently rewritten files)', () => {
    store.write('uptime.json', { a: 1 }, { backup: false })
    store.write('uptime.json', { a: 2 }, { backup: false })
    expect(existsSync(file('uptime.json.bak'))).toBe(false)
  })

  it('creates the folder if it does not exist yet', () => {
    rmSync(dir, { recursive: true })
    expect(store.write('servers.json', [])).toBe(true)
    expect(existsSync(file('servers.json'))).toBe(true)
  })
})
