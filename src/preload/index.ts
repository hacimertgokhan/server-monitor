import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ServerInfo, ServerStatus, Settings } from '@shared/types'

const sub = <T>(channel: string, cb: (v: T) => void): (() => void) => {
  const h = (_: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: Api = {
  getState: () => ipcRenderer.invoke('state:get'),
  saveServer: (i) => ipcRenderer.invoke('server:save', i),
  removeServer: (id) => ipcRenderer.invoke('server:remove', id),
  testServer: (i) => ipcRenderer.invoke('server:test', i),
  pickKeyFile: () => ipcRenderer.invoke('dialog:key'),
  setMode: (m) => ipcRenderer.invoke('mode:set', m),
  updateSettings: (p) => ipcRenderer.invoke('settings:update', p),
  hideToTray: () => ipcRenderer.invoke('app:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onStatus: (cb) => sub<ServerStatus>('status', cb),
  onServers: (cb) => sub<ServerInfo[]>('servers', cb),
  onSettings: (cb) => sub<Settings>('settings', cb)
}

contextBridge.exposeInMainWorld('api', api)
