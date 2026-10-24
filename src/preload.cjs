const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bot', {
  getState: () => ipcRenderer.invoke('state:get'),
  setEnabled: (id, on) => ipcRenderer.invoke('feature:setEnabled', id, on),
  patch: (p) => ipcRenderer.invoke('config:patch', p),
  saveAuth: (payload) => ipcRenderer.invoke('auth:save', payload),
  clearAuth: () => ipcRenderer.invoke('auth:clear'),
  saveProxy: (payload) => ipcRenderer.invoke('proxy:save', payload),
  clearProxyAuth: () => ipcRenderer.invoke('proxy:clearAuth'),
  getLog: () => ipcRenderer.invoke('log:get'),
  popoutLog: () => ipcRenderer.invoke('log:popout'),
  onLog: (cb) => ipcRenderer.on('log', (_e, entry) => cb(entry)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, status) => cb(status)),
  onStats: (cb) => ipcRenderer.on('stats', (_e, stats) => cb(stats)),
  onFeatures: (cb) => ipcRenderer.on('features', (_e, features) => cb(features)),
});
