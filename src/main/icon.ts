import { nativeImage } from 'electron'
import { png } from './png'

export const appIcon = (size = 32): Electron.NativeImage => nativeImage.createFromBuffer(png(size))

/** macOS menu-bar icons must be black + alpha "template" images; the system tints them for light/dark bars. */
export const trayIcon = (): Electron.NativeImage => {
  if (process.platform !== 'darwin') return appIcon(32)
  const img = nativeImage.createFromBuffer(png(32, [0, 0, 0]), { scaleFactor: 2 })
  img.setTemplateImage(true)
  return img
}
