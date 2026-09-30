import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, net, Notification, screen, shell, Tray } from 'electron'
import { join } from 'path'
import { bySeverity, detectIssues, issueText, recoveredText } from '@shared/issues'
import type { IssueLang } from '@shared/issues'
import type { McpState, NewClientInput } from '@shared/mcp'
import type { AppMode, LogRequest, McpResult, ServerInput, ServerStatus, Settings } from '@shared/types'
import { appIcon, trayIcon } from './icon'
import { isAllowedLink } from './links'
import { McpService } from './mcp-server'
import { McpStore } from './mcp-store'
import { Monitor, testConnection } from './monitor'
import { IssueTracker } from './notifier'
import { AUTOSTART_ARG, RESTORE_SHORTCUT, applyAutoStart, isLinux, isMac, isWin, titleBar, wallpaperOptions } from './platform'
import {
  flushSettings,
  getSecrets,
  getSettings,
  listServers,
  loadServers,
  loadSettings,
  loadUptime,
  patchSettings,
  removeServer,
  stopUptime,
  upsertServer
} from './store'
import { checkForUpdates } from './updates'
import { attachToDesktop, wallpaperBounds } from './wallpaper'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let monitor: Monitor
let quitting = false
const tracker = new IssueTracker()
let mcpStore: McpStore
let mcp: McpService

const BG = '#000000'
const APP_ID = 'io.github.hacimertgokhan.servermonitor'

// AppImages cannot ship a setuid chrome-sandbox, and Ubuntu 24.04+ blocks the user-namespace fallback: run without the
// OS-level sandbox there. The renderer still runs with contextIsolation and only ever loads our own bundled files.
if (isLinux && process.env['APPIMAGE']) app.commandLine.appendSwitch('no-sandbox')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => showWindowMode())

function lang(): IssueLang {
  const pref = getSettings().language
  if (pref === 'en' || pref === 'tr') return pref
  return app.getLocale().toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

/** Live wallpaper needs a native desktop-level window; Wayland compositors do not give us one. */
const wallpaperSupported = isWin || isMac || (isLinux && process.env['XDG_SESSION_TYPE'] !== 'wayland')

function createWindow(mode: AppMode): BrowserWindow {
  const s = getSettings()
  const common: Electron.BrowserWindowConstructorOptions = {
    backgroundColor: BG,
    show: false,
    icon: appIcon(256),
    title: 'Server Monitor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  }

  let w: BrowserWindow
  if (mode === 'wallpaper') {
    w = new BrowserWindow({ ...common, ...wallpaperBounds(), ...wallpaperOptions() })
  } else if (mode === 'mini') {
    const wa = screen.getPrimaryDisplay().workArea
    w = new BrowserWindow({
      ...common,
      width: 360,
      height: 560,
      minWidth: 300,
      minHeight: 220,
      x: wa.x + wa.width - 380,
      y: wa.y + wa.height - 580,
      alwaysOnTop: s.miniOnTop,
      skipTaskbar: true,
      ...titleBar(32)
    })
  } else {
    w = new BrowserWindow({ ...common, width: 1360, height: 860, minWidth: 900, minHeight: 600, ...titleBar(40) })
  }

  w.setMenuBarVisibility(false)
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedLink(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file://')) e.preventDefault()
  })

  w.on('close', (e) => {
    if (quitting || mode === 'wallpaper') return
    if (getSettings().closeToTray) {
      e.preventDefault()
      w.hide()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?mode=${mode}`)
  } else {
    void w.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode } })
  }

  if (mode === 'wallpaper') {
    // Explorer restarted (or crashed): its Progman window took ours down with it — bring the wallpaper back.
    w.on('closed', () => {
      if (quitting || getSettings().mode !== 'wallpaper' || win !== w) return
      setTimeout(() => {
        if (!quitting && getSettings().mode === 'wallpaper') win = createWindow('wallpaper')
      }, 3000)
    })
  }

  w.once('ready-to-show', () => {
    if (mode !== 'wallpaper') return w.show()
    w.showInactive()
    if (!isWin) {
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
      return
    }
    void attachWithRetry(w).then((ok) => {
      if (ok || w.isDestroyed()) return
      // Never leave an un-clickable fullscreen window on top of the user's desktop: go back to window mode.
      switchMode('window')
      const log = join(app.getPath('userData'), 'wallpaper.log')
      void dialog.showMessageBox({
        type: 'warning',
        title: 'Server Monitor',
        message: lang() === 'tr' ? 'Duvar kağıdı moduna geçilemedi.' : 'Could not switch to wallpaper mode.',
        detail:
          lang() === 'tr'
            ? `Pencere masaüstü simgelerinin arkasına yerleştirilemedi. Ayrıntı: ${log}`
            : `The window could not be placed behind the desktop icons. Details: ${log}`
      })
    })
  })
  return w
}

/** At Windows login the shell may not be ready yet, so retry for ~15s before giving up. */
async function attachWithRetry(w: BrowserWindow, tries = 6): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (w.isDestroyed()) return false
    if (await attachToDesktop(w)) return true
    await new Promise((r) => setTimeout(r, 3000))
  }
  return false
}

function switchMode(mode: AppMode): void {
  if (mode === 'wallpaper' && !wallpaperSupported) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Server Monitor',
      message: lang() === 'tr' ? 'Duvar kağıdı modu bu masaüstünde desteklenmiyor.' : 'Wallpaper mode is not supported on this desktop.',
      detail:
        lang() === 'tr'
          ? 'Wayland oturumları uygulamaların masaüstü katmanına pencere koymasına izin vermez. X11 oturumunda deneyin.'
          : 'Wayland sessions do not let applications place a window on the desktop layer. Try an X11 session.'
    })
    return
  }
  patchSettings({ mode })
  const old = win
  win = createWindow(mode)
  if (old && !old.isDestroyed()) {
    old.removeAllListeners('close')
    old.destroy()
  }
  broadcast('settings', getSettings())
  refreshTray()
}

function showWindowMode(): void {
  if (getSettings().mode === 'wallpaper') return switchMode('window')
  if (!win || win.isDestroyed()) win = createWindow(getSettings().mode)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function refreshTray(): void {
  if (!tray) return
  const mode = getSettings().mode
  const tr = lang() === 'tr'
  const item = (label: string, m: AppMode): Electron.MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: mode === m,
    click: () => switchMode(m)
  })
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: tr ? 'Göster' : 'Show', click: showWindowMode },
      { type: 'separator' },
      item(tr ? 'Pencere modu' : 'Window mode', 'window'),
      item(tr ? 'Mini mod' : 'Mini mode', 'mini'),
      item(tr ? 'Duvar kağıdı modu' : 'Wallpaper mode', 'wallpaper'),
      { type: 'separator' },
      { label: tr ? 'Çıkış' : 'Quit', click: () => app.quit() }
    ])
  )
}

// ---------------------------------------------------------------- notifications
function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: appIcon(128) })
  n.on('click', () => showWindowMode())
  n.show()
}

/** Compares each new status with what we already know and tells the user about *new* problems only. */
function onStatus(st: ServerStatus): void {
  broadcast('status', st)
  const settings = getSettings()
  if (!settings.notifications) return tracker.forget(st.id)
  const { fire, recovered } = tracker.update(st.id, detectIssues(st, settings.thresholds))
  const name = listServers().find((s) => s.id === st.id)?.name ?? st.id
  const l = lang()
  for (const i of [...fire].sort(bySeverity).slice(0, 4)) {
    const title = i.kind === 'offline' ? `${name}: ${l === 'tr' ? 'çevrimdışı' : 'offline'}` : name
    notify(title, issueText(i, l))
  }
  for (const _ of recovered) notify(name, recoveredText(l))
}

// ---------------------------------------------------------------- MCP (agents)
function mcpState(): McpState {
  const v = mcpStore.view()
  return {
    enabled: v.enabled,
    port: v.port,
    listening: mcp.listening,
    error: mcp.error,
    url: `http://127.0.0.1:${v.port}/mcp`,
    clients: v.clients,
    policy: v.policy
  }
}

const pushMcp = (): void => broadcast('mcp:update', mcpState())

async function applyMcp(): Promise<void> {
  if (mcpStore.enabled) await mcp.start(mcpStore.port)
  else await mcp.stop()
  pushMcp()
}

/** A native dialog (not the renderer) asks the user, so an agent can never approve its own command. */
async function approveCommand(req: { clientName: string; serverName: string; command: string }): Promise<boolean> {
  const tr = lang() === 'tr'
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 120_000)
  notify(tr ? 'Komut onayı bekleniyor' : 'Command approval needed', `${req.clientName} → ${req.serverName}`)
  try {
    const r = await dialog.showMessageBox({
      type: 'warning',
      title: tr ? 'Komut onayı' : 'Approve command',
      message: tr
        ? `"${req.clientName}" ajanı "${req.serverName}" sunucusunda bir komut çalıştırmak istiyor.`
        : `Agent "${req.clientName}" wants to run a command on "${req.serverName}".`,
      detail: req.command.length > 1500 ? `${req.command.slice(0, 1500)}…` : req.command,
      buttons: [tr ? 'Reddet' : 'Deny', tr ? 'Bir kez izin ver' : 'Allow once'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      signal: abort.signal
    })
    return r.response === 1
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Runs an MCP management call and turns failures into a result the UI can show. */
async function mcpCall(fn: () => { token?: string } | void | Promise<{ token?: string } | void>): Promise<McpResult> {
  try {
    const extra = (await fn()) ?? {}
    pushMcp()
    return { ok: true, state: mcpState(), token: extra.token }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------- IPC
const LOG_KINDS = new Set(['docker', 'pm2', 'service'])

function registerIpc(): void {
  ipcMain.handle('state:get', () => ({
    servers: listServers(),
    statuses: monitor.snapshot(),
    settings: getSettings()
  }))

  ipcMain.handle('server:save', (_e, input: ServerInput) => {
    const info = upsertServer(input)
    monitor.add(info.id)
    broadcast('servers', listServers())
    return info
  })

  ipcMain.handle('server:remove', (_e, id: string) => {
    monitor.remove(id)
    tracker.forget(id)
    removeServer(id)
    mcpStore.pruneServers(listServers().map((x) => x.id))
    pushMcp()
    const { positions, cardScales, expanded } = getSettings()
    patchSettings({
      positions: Object.fromEntries(Object.entries(positions).filter(([k]) => k !== id)),
      cardScales: Object.fromEntries(Object.entries(cardScales).filter(([k]) => k !== id)),
      expanded: Object.fromEntries(Object.entries(expanded).filter(([k]) => k !== id))
    })
    broadcast('servers', listServers())
  })

  ipcMain.handle('server:test', (_e, input: ServerInput) => {
    // On edit with blank secret, fall back to the stored one so "Test" works without retyping.
    const stored = input.id ? getSecrets(input.id) : undefined
    return testConnection({
      id: input.id ?? 'test',
      name: input.name,
      host: input.host,
      port: input.port || 22,
      username: input.username,
      authType: input.authType,
      keyPath: input.keyPath,
      password: input.password || stored?.password,
      passphrase: input.passphrase || stored?.passphrase
    })
  })

  ipcMain.handle('dialog:key', async () => {
    const r = await dialog.showOpenDialog({ title: 'Select private key', properties: ['openFile', 'showHiddenFiles'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('mode:set', (_e, mode: AppMode) => switchMode(mode))

  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => {
    const { mode: _ignored, ...safe } = patch // mode changes go through mode:set
    const s = patchSettings(safe)
    if ('autoStart' in safe) applyAutoStart(s.autoStart)
    if ('miniOnTop' in safe && win && getSettings().mode === 'mini') win.setAlwaysOnTop(s.miniOnTop)
    if ('language' in safe) refreshTray()
    broadcast('settings', s)
    return s
  })

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }))

  ipcMain.handle('link:open', async (_e, url: unknown) => {
    // The renderer is untrusted input: only our own site, repo and contact address may be opened.
    if (typeof url === 'string' && isAllowedLink(url)) await shell.openExternal(url)
  })

  ipcMain.handle('updates:check', () => checkForUpdates(app.getVersion(), (u, init) => net.fetch(String(u), init as RequestInit)))

  ipcMain.handle('logs:fetch', (_e, req: LogRequest) => {
    const ok =
      req && typeof req.serverId === 'string' && typeof req.name === 'string' && LOG_KINDS.has(req.kind) && Number.isFinite(req.lines)
    return ok ? monitor.logs(req) : { ok: false, text: '', error: 'Unknown item', at: Date.now() }
  })

  ipcMain.handle('mcp:state', () => mcpState())
  ipcMain.handle('mcp:enable', (_e, on: unknown) =>
    mcpCall(async () => {
      mcpStore.setEnabled(on === true)
      await applyMcp()
    })
  )
  ipcMain.handle('mcp:port', (_e, port: unknown) =>
    mcpCall(async () => {
      mcpStore.setPort(port)
      if (mcpStore.enabled) await applyMcp()
    })
  )
  ipcMain.handle('mcp:agent:create', (_e, input: NewClientInput) =>
    mcpCall(() => {
      const { token } = mcpStore.createClient(input)
      return { token }
    })
  )
  ipcMain.handle('mcp:agent:update', (_e, id: string, patch: Parameters<McpStore['updateClient']>[1]) =>
    mcpCall(() => {
      mcpStore.updateClient(String(id), patch ?? {})
    })
  )
  ipcMain.handle('mcp:agent:rotate', (_e, id: string) =>
    mcpCall(() => {
      const { token } = mcpStore.rotateToken(String(id))
      return { token }
    })
  )
  ipcMain.handle('mcp:agent:delete', (_e, id: string) =>
    mcpCall(() => {
      mcpStore.deleteClient(String(id))
    })
  )
  ipcMain.handle('mcp:policy', (_e, policy: unknown) =>
    mcpCall(() => {
      mcpStore.setPolicy(policy)
    })
  )
  ipcMain.handle('mcp:audit', (_e, limit: unknown) =>
    mcpStore.readAudit(typeof limit === 'number' ? Math.min(Math.max(limit, 1), 1000) : 200)
  )
  ipcMain.handle('mcp:audit:clear', () => {
    mcpStore.clearAudit()
  })

  ipcMain.handle('app:hide', () => win?.hide())
  ipcMain.handle('app:quit', () => app.quit())
}

app.whenReady().then(() => {
  if (isWin) app.setAppUserModelId(APP_ID) // required for notifications and taskbar grouping
  // macOS needs an application menu for Cmd+C/V/Q; elsewhere the window has no menu bar at all.
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)

  loadServers()
  loadSettings()
  loadUptime()

  monitor = new Monitor(() => getSettings().pollSec)
  monitor.on('status', onStatus)
  mcpStore = new McpStore(app.getPath('userData'))
  mcp = new McpService({
    store: mcpStore,
    version: app.getVersion(),
    listServers,
    getStatus: (id) => monitor.status(id),
    thresholds: () => getSettings().thresholds,
    fetchLogs: (req) => monitor.logs(req),
    exec: (id, cmd, timeoutMs, maxBytes) => monitor.exec(id, cmd, timeoutMs, maxBytes),
    approve: approveCommand,
    changed: pushMcp
  })
  registerIpc()
  for (const s of listServers()) monitor.add(s.id)
  if (mcpStore.enabled) void applyMcp()

  tray = new Tray(trayIcon())
  tray.setToolTip('Server Monitor')
  if (isWin) tray.on('double-click', showWindowMode)
  else tray.on('click', showWindowMode)
  refreshTray()

  // Wallpaper mode is not clickable — this shortcut always gets you back to the normal window.
  globalShortcut.register(RESTORE_SHORTCUT, () => {
    if (getSettings().mode === 'wallpaper') switchMode('window')
    else if (win?.isVisible()) win.hide()
    else showWindowMode()
  })

  // A manual launch always opens the normal window: a remembered wallpaper mode is invisible behind other windows,
  // which looks like "the app shows nothing". Only an automatic start at login restores the wallpaper.
  if (getSettings().mode === 'wallpaper' && (!process.argv.includes(AUTOSTART_ARG) || !wallpaperSupported))
    patchSettings({ mode: 'window' })
  win = createWindow(getSettings().mode)

  screen.on('display-metrics-changed', () => {
    if (isWin && getSettings().mode === 'wallpaper' && win && !win.isDestroyed()) void attachToDesktop(win)
  })
})

// macOS: clicking the dock icon reopens the window.
app.on('activate', () => showWindowMode())

app.on('before-quit', () => {
  quitting = true
  globalShortcut.unregisterAll()
  monitor?.stopAll()
  void mcp?.stop()
  mcpStore?.flush()
  flushSettings()
  stopUptime()
})

app.on('window-all-closed', () => {
  if (quitting) return app.quit()
  if (getSettings().mode === 'wallpaper') return // the wallpaper window is being re-created
  // Without a tray to come back from (default on Linux), closing the last window means quit. macOS keeps the app alive.
  if (!isMac && !getSettings().closeToTray) app.quit()
})
