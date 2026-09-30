import { app } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

/** Global shortcut that always brings the normal window back (Ctrl+Alt+M, Cmd+Alt+M on macOS). */
export const RESTORE_SHORTCUT = 'CommandOrControl+Alt+M'

export const AUTOSTART_ARG = '--autostart'

const BG = '#000000'

/** Title bar for the window and mini modes: native controls drawn over our own header. */
export function titleBar(height: number): BrowserWindowConstructorOptions {
  if (isMac) return { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: Math.round((height - 14) / 2) } }
  return { titleBarStyle: 'hidden', titleBarOverlay: { color: BG, symbolColor: '#969393', height } }
}

/**
 * Wallpaper window. Windows is handled by re-parenting into the desktop (see wallpaper.ts). macOS and X11 have a
 * native "desktop" window type that sits behind the icons; it never receives input, so use RESTORE_SHORTCUT / tray.
 */
export function wallpaperOptions(): BrowserWindowConstructorOptions {
  const base: BrowserWindowConstructorOptions = {
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false
  }
  if (isWin) return { ...base, thickFrame: false } // otherwise Chromium insets the client area by the resize border
  return { ...base, type: 'desktop' }
}

const AUTOSTART_FILE = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart', 'server-monitor.desktop')

/** Start at login. Windows/macOS use login items; Linux uses an XDG autostart entry. Only for the packaged app. */
export function applyAutoStart(on: boolean): void {
  if (!app.isPackaged) return
  if (!isLinux) {
    app.setLoginItemSettings({ openAtLogin: on, args: [AUTOSTART_ARG] })
    return
  }
  try {
    if (!on) {
      if (existsSync(AUTOSTART_FILE)) unlinkSync(AUTOSTART_FILE)
      return
    }
    mkdirSync(dirname(AUTOSTART_FILE), { recursive: true })
    const exec = process.env.APPIMAGE ?? process.execPath
    writeFileSync(
      AUTOSTART_FILE,
      `[Desktop Entry]\nType=Application\nName=Server Monitor\nExec="${exec}" ${AUTOSTART_ARG}\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`
    )
  } catch {
    /* read-only home or sandbox: autostart is a convenience, never fatal */
  }
}
