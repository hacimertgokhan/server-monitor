import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Api, AppMode, ServerInfo, ServerStatus, Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { DEMO_SERVERS, demoStatus } from './demo'

const api: Api | undefined = (window as unknown as { api?: Api }).api
export const hasBackend = !!api

/** 'win32' | 'darwin' | 'linux' (guessed from the user agent in the browser preview). */
export const platform: string =
  api?.platform ?? (/Mac/i.test(navigator.userAgent) ? 'darwin' : /Linux|X11/i.test(navigator.userAgent) ? 'linux' : 'win32')
export const isMac = platform === 'darwin'

const queryMode = (): AppMode => {
  const m = new URLSearchParams(location.search).get('mode')
  return m === 'mini' || m === 'wallpaper' ? m : 'window'
}

const DEMO_KEY = 'server-monitor:demo'
const readDemo = (): boolean => {
  try {
    return localStorage.getItem(DEMO_KEY) === '1'
  } catch {
    return false
  }
}

export function useMonitor() {
  const [realServers, setRealServers] = useState<ServerInfo[]>([])
  const [realStatuses, setRealStatuses] = useState<Record<string, ServerStatus>>({})
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, mode: queryMode() })
  const [ready, setReady] = useState(!hasBackend)
  const [dataIssues, setDataIssues] = useState<string[]>([])
  const [demoOn, setDemoOn] = useState(!hasBackend || readDemo())
  const [demoStatuses, setDemoStatuses] = useState<Record<string, ServerStatus>>({})
  const demoRef = useRef<Record<string, ServerStatus>>({})
  // In-flight settings writes: broadcasts that arrive meanwhile are stale (would make sliders jump back).
  const pending = useRef(0)

  // ---- Electron backend
  useEffect(() => {
    if (!api) return
    void api.getState().then((s) => {
      setRealServers(s.servers)
      setRealStatuses(s.statuses)
      setSettings(s.settings)
      setDataIssues(s.dataIssues)
      setReady(true)
    })
    const offs = [
      api.onStatus((st) => setRealStatuses((p) => ({ ...p, [st.id]: st }))),
      api.onServers((list) => setRealServers(list)),
      api.onSettings((s) => {
        if (pending.current === 0) setSettings(s)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // ---- Demo generator (only shown when there are no real servers, or in browser preview)
  const useDemo = demoOn && (!hasBackend || realServers.length === 0)
  useEffect(() => {
    if (!useDemo) return
    const step = (): void => {
      const next: Record<string, ServerStatus> = {}
      for (const s of DEMO_SERVERS) next[s.id] = demoStatus(s.id, demoRef.current[s.id])
      demoRef.current = next
      setDemoStatuses(next)
    }
    step()
    const t = setInterval(step, 2500)
    return () => clearInterval(t)
  }, [useDemo])

  /** Asks the main process to read the saved servers and settings again (after a failed start). */
  const reloadData = useCallback(async () => {
    if (!api) return
    const s = await api.reloadData()
    setRealServers(s.servers)
    setRealStatuses(s.statuses)
    setSettings(s.settings)
    setDataIssues(s.dataIssues)
  }, [])

  // A file that was locked at startup (antivirus, sync tool ...) usually becomes readable seconds later: retry quietly.
  const hasIssues = dataIssues.length > 0
  useEffect(() => {
    if (!hasIssues) return
    let tries = 0
    const id = setInterval(() => {
      if (++tries > 12) return clearInterval(id)
      void reloadData()
    }, 4000)
    return () => clearInterval(id)
  }, [hasIssues, reloadData])

  const toggleDemo = useCallback((on: boolean) => {
    setDemoOn(on)
    try {
      localStorage.setItem(DEMO_KEY, on ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }, [])

  const servers = useDemo ? DEMO_SERVERS : realServers
  const statuses = useDemo ? demoStatuses : realStatuses

  const setMode = useCallback((mode: AppMode) => {
    if (api) void api.setMode(mode)
    else setSettings((s) => ({ ...s, mode }))
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch })) // optimistic
    if (!api) return
    pending.current++
    void api.updateSettings(patch).finally(() => {
      pending.current--
    })
  }, [])

  const summary = useMemo(() => {
    const list = servers.map((s) => statuses[s.id]).filter(Boolean)
    const online = list.filter((s) => s.state === 'online')
    return {
      total: servers.length,
      online: online.length,
      offline: list.filter((s) => s.state === 'offline').length,
      avgCpu: online.length ? online.reduce((a, s) => a + s.cpu, 0) / online.length : 0,
      avgMem: online.length ? online.reduce((a, s) => a + s.memPct, 0) / online.length : 0,
      rx: online.reduce((a, s) => a + s.netRx, 0),
      tx: online.reduce((a, s) => a + s.netTx, 0)
    }
  }, [servers, statuses])

  return {
    api,
    ready,
    dataIssues,
    reloadData,
    servers,
    statuses,
    settings,
    summary,
    isDemo: useDemo,
    demoOn,
    toggleDemo,
    setMode,
    updateSettings
  }
}
