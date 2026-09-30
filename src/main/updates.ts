import type { UpdateInfo } from '@shared/types'

const LATEST = 'https://api.github.com/repos/hacimertgokhan/server-monitor/releases/latest'

/** True when `latest` is a higher semantic version than `current` (leading "v" and pre-release tags are ignored). */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/** Runs only when the user presses "Check for updates"; the app never phones home on its own. */
export async function checkForUpdates(current: string, fetcher: typeof fetch = fetch): Promise<UpdateInfo> {
  try {
    const res = await fetcher(LATEST, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'server-monitor' } })
    if (!res.ok) return { ok: false, current, error: `GitHub answered ${res.status}` }
    const j = (await res.json()) as { tag_name?: string; html_url?: string }
    if (!j.tag_name) return { ok: false, current, error: 'No release found' }
    return { ok: true, current, latest: j.tag_name.replace(/^v/i, ''), url: j.html_url, newer: isNewer(j.tag_name, current) }
  } catch (e) {
    return { ok: false, current, error: e instanceof Error ? e.message : String(e) }
  }
}
