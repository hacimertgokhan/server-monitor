import { nativeImage } from 'electron'
import { png } from './png'

export const appIcon = (size = 32): Electron.NativeImage => nativeImage.createFromBuffer(png(size))
