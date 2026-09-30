import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, screen, shell, Tray } from 'electron'
import { join } from 'path'
import type { AppMode, ServerInput, Settings } from '@shared/types'
import { appIcon } from './icon'
import { Monitor, testConnection } from './monitor'
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
import { attachToDesktop, wallpaperBounds } from './wallpaper'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let monitor: Monitor
let quitting = false

const BG = '#000000'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => showWindowMode())

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

function createWindow(mode: AppMode): BrowserWindow {
  const s = getSettings()
  const common: Electron.BrowserWindowConstructorOptions = {
    backgroundColor: BG,
    show: false,
    icon: appIcon(64),
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
    const b = wallpaperBounds()
    w = new BrowserWindow({
      ...common,
      ...b,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      thickFrame: false // otherwise Chromium insets the client area by the (invisible) resize border
    })
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
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: BG, symbolColor: '#969393', height: 32 }
    })
  } else {
    w = new BrowserWindow({
      ...common,
      width: 1360,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: BG, symbolColor: '#969393', height: 40 }
    })
  }

  w.setMenuBarVisibility(false)
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
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

  const query = { mode }
  if (process.env['ELECTRON_RENDERER_URL']) {
    void w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?mode=${mode}`)
  } else {
    void w.loadFile(join(__dirname, '../renderer/index.html'), { query })
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
    if (mode === 'wallpaper') {
      w.showInactive()
      void attachWithRetry(w).then((ok) => {
        if (ok || w.isDestroyed()) return
        // Never leave an un-clickable fullscreen window on top of the user's desktop: go back to window mode.
        switchMode('window')
        const tr = app.getLocale().toLowerCase().startsWith('tr')
        const log = join(app.getPath('userData'), 'wallpaper.log')
        void dialog.showMessageBox({
          type: 'warning',
          title: 'Server Monitor',
          message: tr ? 'Duvar kağıdı moduna geçilemedi.' : 'Could not switch to wallpaper mode.',
          detail: tr
            ? `Pencere masaüstü simgelerinin arkasına yerleştirilemedi. Ayrıntı: ${log}`
            : `The window could not be placed behind the desktop icons. Details: ${log}`
        })
      })
    } else {
      w.show()
    }
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
  const tr = app.getLocale().toLowerCase().startsWith('tr')
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

function applyAutoStart(on: boolean): void {
  // Only register the packaged app; in dev this would register electron.exe itself.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on })
}

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
    removeServer(id)
    const positions = { ...getSettings().positions }
    delete positions[id]
    patchSettings({ positions })
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
    broadcast('settings', s)
    return s
  })

  ipcMain.handle('app:hide', () => win?.hide())
  ipcMain.handle('app:quit', () => app.quit())
}

app.whenReady().then(() => {
  loadServers()
  loadSettings()
  loadUptime()

  monitor = new Monitor(() => getSettings().pollSec)
  monitor.on('status', (st) => broadcast('status', st))
  registerIpc()
  for (const s of listServers()) monitor.add(s.id)

  tray = new Tray(appIcon(32))
  tray.setToolTip('Server Monitor')
  tray.on('double-click', showWindowMode)
  refreshTray()

  // Wallpaper mode is not clickable — this shortcut always gets you back to the normal window.
  globalShortcut.register('Control+Alt+M', () => {
    if (getSettings().mode === 'wallpaper') switchMode('window')
    else if (win?.isVisible()) win.hide()
    else showWindowMode()
  })

  win = createWindow(getSettings().mode)

  screen.on('display-metrics-changed', () => {
    if (getSettings().mode === 'wallpaper' && win && !win.isDestroyed()) void attachToDesktop(win)
  })
})

app.on('before-quit', () => {
  quitting = true
  globalShortcut.unregisterAll()
  monitor?.stopAll()
  flushSettings()
  stopUptime()
})

// Keep running in the tray when every window is hidden/closed.
app.on('window-all-closed', () => {
  if (quitting) app.quit()
})
