import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { AnonymizeOptions, FileResult } from '../shared/entities'
import type { WorkerRequest, WorkerResponse } from '../shared/ipc'
import type { Preferences } from '../shared/ipc'
import { loadPreferences, savePreferences } from './preferences'
import { applyPrivacySwitches, hardenWebContents, lockDownNetwork, wipeSessionData } from './privacy'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
const SHANOON_URL = 'https://shanoon.sk'

const APP_NAME = 'Anonymizer by Shanoon'
app.setName(APP_NAME)
applyPrivacySwitches()
app.setAppUserModelId('sk.shanoon.anonymizer')

/** macOS needs an app menu (name + Edit menu, otherwise Cmd+C/V do not work in text fields). */
function setupMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion(), copyright: '© Shanoon' })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: APP_NAME,
        submenu: [
          { role: 'about', label: `O aplikácii ${APP_NAME}` },
          { type: 'separator' },
          { role: 'hide', label: `Skryť ${APP_NAME}` },
          { role: 'hideOthers', label: 'Skryť ostatné' },
          { role: 'unhide', label: 'Zobraziť všetko' },
          { type: 'separator' },
          { role: 'quit', label: `Ukončiť ${APP_NAME}` }
        ]
      },
      {
        label: 'Upraviť',
        submenu: [
          { role: 'undo', label: 'Späť' },
          { role: 'redo', label: 'Znova' },
          { type: 'separator' },
          { role: 'cut', label: 'Vystrihnúť' },
          { role: 'copy', label: 'Kopírovať' },
          { role: 'paste', label: 'Vložiť' },
          { role: 'selectAll', label: 'Vybrať všetko' }
        ]
      },
      {
        label: 'Okno',
        submenu: [
          { role: 'minimize', label: 'Minimalizovať' },
          { role: 'zoom', label: 'Zväčšiť' },
          { role: 'close', label: 'Zavrieť' }
        ]
      }
    ])
  )
}
// Separate profile for automated tests, so they can run while the app is open.
if (process.env.ANON_USER_DATA) app.setPath('userData', process.env.ANON_USER_DATA)
// One instance only – a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) app.quit()

/** Bundled offline assets: ./resources in dev, <install>/resources when packaged. */
function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

let win: BrowserWindow | null = null
let worker: UtilityProcess | null = null
let nextId = 1
const pending = new Map<number, { resolve: (r: FileResult[]) => void; reject: (e: Error) => void }>()

function startWorker(): UtilityProcess {
  const res = resourcesDir()
  const w = utilityProcess.fork(join(__dirname, 'worker.js'), [], {
    serviceName: 'Anonymizer – spracovanie',
    env: {
      ...process.env,
      ANON_MODELS_DIR: join(res, 'models'),
      ANON_TESSDATA_DIR: join(res, 'tessdata')
    },
    stdio: 'inherit'
  })
  w.on('message', (msg: WorkerResponse) => {
    if (msg.kind === 'progress') win?.webContents.send('progress', msg.event)
    else {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.kind === 'result') p.resolve(msg.results)
      else p.reject(new Error(msg.message))
    }
  })
  w.on('exit', () => {
    worker = null
    for (const p of pending.values()) p.reject(new Error('Spracovanie bolo neočakávane ukončené.'))
    pending.clear()
  })
  return w
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 880,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14181a' : '#ffffff',
    autoHideMenuBar: true,
    show: false,
    icon: join(resourcesDir(), 'brand', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: isDev
    }
  })
  hardenWebContents(win.webContents, isDev)
  win.once('ready-to-show', () => win?.show())
  if (isDev) win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Vyberte súbory na anonymizáciu',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Dokumenty (PDF, Word, Excel)', extensions: ['pdf', 'docx', 'xlsx', 'xlsm'] },
      { name: 'Všetky súbory', extensions: ['*'] }
    ]
  })
  return r.canceled ? [] : r.filePaths
})

ipcMain.handle('pick-output-dir', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Kam uložiť anonymizované súbory',
    properties: ['openDirectory', 'createDirectory']
  })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('process', (_e, inputs: string[], options: AnonymizeOptions, outDir: string | null) => {
  worker ??= startWorker()
  const id = nextId++
  return new Promise<FileResult[]>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const req: WorkerRequest = { kind: 'process', id, inputs, options, outDir }
    worker!.postMessage(req)
  })
})

ipcMain.handle('show-in-folder', (_e, p: string) => shell.showItemInFolder(p))
ipcMain.handle('open-file', async (_e, p: string) => void (await shell.openPath(p)))
ipcMain.handle('open-shanoon', () => shell.openExternal(SHANOON_URL))
ipcMain.handle('prefs-load', () => loadPreferences())
ipcMain.handle('prefs-save', (_e, p: Preferences) => savePreferences(p))

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  lockDownNetwork(isDev ? process.env.ELECTRON_RENDERER_URL : undefined)
  setupMenu()
  if (process.platform === 'darwin' && isDev) app.dock?.setIcon(join(resourcesDir(), 'brand', 'icon.png'))
  worker = startWorker()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let wiped = false
app.on('before-quit', (e) => {
  if (wiped) return
  e.preventDefault()
  worker?.kill()
  wipeSessionData().finally(() => {
    wiped = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
