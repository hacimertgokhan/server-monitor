import { contextBridge, ipcRenderer } from 'electron'
import type { McpState } from '@shared/mcp'
import type { Api, ServerInfo, ServerStatus, Settings } from '@shared/types'

const sub = <T>(channel: string, cb: (v: T) => void): (() => void) => {
  const h = (_: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: Api = {
  platform: process.platform,
  mcp: {
    getState: () => ipcRenderer.invoke('mcp:state'),
    setEnabled: (on) => ipcRenderer.invoke('mcp:enable', on),
    setPort: (port) => ipcRenderer.invoke('mcp:port', port),
    createAgent: (input) => ipcRenderer.invoke('mcp:agent:create', input),
    updateAgent: (id, patch) => ipcRenderer.invoke('mcp:agent:update', id, patch),
    rotateToken: (id) => ipcRenderer.invoke('mcp:agent:rotate', id),
    deleteAgent: (id) => ipcRenderer.invoke('mcp:agent:delete', id),
    setPolicy: (policy) => ipcRenderer.invoke('mcp:policy', policy),
    getAudit: (limit) => ipcRenderer.invoke('mcp:audit', limit),
    clearAudit: () => ipcRenderer.invoke('mcp:audit:clear'),
    onChange: (cb) => sub<McpState>('mcp:update', cb)
  },
  getState: () => ipcRenderer.invoke('state:get'),
  saveServer: (i) => ipcRenderer.invoke('server:save', i),
  removeServer: (id) => ipcRenderer.invoke('server:remove', id),
  testServer: (i) => ipcRenderer.invoke('server:test', i),
  pickKeyFile: () => ipcRenderer.invoke('dialog:key'),
  setMode: (m) => ipcRenderer.invoke('mode:set', m),
  updateSettings: (p) => ipcRenderer.invoke('settings:update', p),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('link:open', url),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  fetchLogs: (req) => ipcRenderer.invoke('logs:fetch', req),
  hideToTray: () => ipcRenderer.invoke('app:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onStatus: (cb) => sub<ServerStatus>('status', cb),
  onServers: (cb) => sub<ServerInfo[]>('servers', cb),
  onSettings: (cb) => sub<Settings>('settings', cb)
}

contextBridge.exposeInMainWorld('api', api)
