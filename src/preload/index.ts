import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { McpState } from '@shared/mcp'
import type { Transfer, TermStateEvent } from '@shared/remote'
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
  term: {
    open: (id, serverId, cols, rows) => ipcRenderer.invoke('term:open', id, serverId, cols, rows),
    input: (id, data) => ipcRenderer.send('term:input', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
    ack: (id, n) => ipcRenderer.send('term:ack', id, n),
    close: (id) => ipcRenderer.send('term:close', id),
    onData: (cb) => sub<{ id: string; data: string }>('term:data', (v) => cb(v.id, v.data)),
    onState: (cb) => sub<TermStateEvent>('term:state', cb)
  },
  sftp: {
    list: (serverId, path) => ipcRenderer.invoke('sftp:list', serverId, path),
    mkdir: (serverId, path) => ipcRenderer.invoke('sftp:mkdir', serverId, path),
    create: (serverId, path) => ipcRenderer.invoke('sftp:create', serverId, path),
    rename: (serverId, from, to) => ipcRenderer.invoke('sftp:rename', serverId, from, to),
    remove: (serverId, paths) => ipcRenderer.invoke('sftp:remove', serverId, paths),
    chmod: (serverId, path, mode) => ipcRenderer.invoke('sftp:chmod', serverId, path, mode),
    readText: (serverId, path) => ipcRenderer.invoke('sftp:read', serverId, path),
    writeText: (serverId, path, text) => ipcRenderer.invoke('sftp:write', serverId, path, text),
    download: (serverId, paths) => ipcRenderer.invoke('sftp:download', serverId, paths),
    uploadPick: (serverId, dir, kind) => ipcRenderer.invoke('sftp:uploadPick', serverId, dir, kind),
    upload: (serverId, dir, paths) => ipcRenderer.invoke('sftp:upload', serverId, dir, paths),
    cancel: (id) => ipcRenderer.send('sftp:cancel', id),
    pathForFile: (file) => webUtils.getPathForFile(file),
    onTransfer: (cb) => sub<Transfer>('sftp:transfer', cb)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:read'),
    writeText: (text) => ipcRenderer.invoke('clipboard:write', text)
  },
  openWebLink: (url) => ipcRenderer.invoke('link:open-web', url),
  getState: () => ipcRenderer.invoke('state:get'),
  reloadData: () => ipcRenderer.invoke('data:reload'),
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
