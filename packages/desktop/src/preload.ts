import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI } from './contract.js'

const api: DesktopAPI = {
  open: () => ipcRenderer.invoke('foundation:open'),
  state: () => ipcRenderer.invoke('foundation:state'),
  commit: (ops, message) => ipcRenderer.invoke('foundation:commit', ops, message),
  annotate: input => ipcRenderer.invoke('foundation:annotate', input),
  connection: action => ipcRenderer.invoke('foundation:connection', action),
  export: () => ipcRenderer.invoke('foundation:export'),
}
contextBridge.exposeInMainWorld('foundationHost', api)
