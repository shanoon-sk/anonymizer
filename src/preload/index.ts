import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AnonymoApi } from '../shared/ipc'
import type { ProgressEvent } from '../shared/entities'

const api: AnonymoApi = {
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickOutputDir: () => ipcRenderer.invoke('pick-output-dir'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  process: (inputs, options, outDir) => ipcRenderer.invoke('process', inputs, options, outDir),
  onProgress: (cb) => {
    const h = (_e: unknown, ev: ProgressEvent) => cb(ev)
    ipcRenderer.on('progress', h)
    return () => ipcRenderer.removeListener('progress', h)
  },
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  openFile: (p) => ipcRenderer.invoke('open-file', p),
  openShanoon: () => ipcRenderer.invoke('open-shanoon'),
  loadPreferences: () => ipcRenderer.invoke('prefs-load'),
  savePreferences: (p) => ipcRenderer.invoke('prefs-save', p),
  version: __APP_VERSION__
}

contextBridge.exposeInMainWorld('anonymo', api)
