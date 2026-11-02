import { app, session, type WebContents } from 'electron'

/**
 * Hard offline mode. The app must never talk to the network: all processing is local,
 * models ship with the app. Anything that is not a local resource is cancelled.
 */
export function lockDownNetwork(devServerUrl?: string): void {
  const allowed = (url: string) =>
    url.startsWith('file:') ||
    url.startsWith('devtools:') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    (devServerUrl !== undefined && (url.startsWith(devServerUrl) || url.startsWith(devServerUrl.replace('localhost', '127.0.0.1')) || url.startsWith('ws://localhost')))

  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: !allowed(details.url) })
  })
  // No permission (camera, geolocation, notifications…) is ever needed.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setSpellCheckerEnabled(false)
  // Spell-check dictionaries would otherwise be downloaded from Google servers.
  session.defaultSession.setSpellCheckerDictionaryDownloadURL('file:///dev/null/')
}

/** Chromium switches applied before `ready`. */
export function applyPrivacySwitches(): void {
  app.commandLine.appendSwitch('disable-http-cache')
  app.commandLine.appendSwitch('disable-background-networking')
  app.commandLine.appendSwitch('disable-component-update')
  app.commandLine.appendSwitch('disable-domain-reliability')
  app.commandLine.appendSwitch('disable-breakpad')
  app.commandLine.appendSwitch('no-pings')
  app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,AutofillServerCommunication,OptimizationHints,MediaRouter')
}

export function hardenWebContents(wc: WebContents, isDev: boolean): void {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e, url) => {
    if (!(isDev && url.startsWith('http://localhost'))) e.preventDefault()
  })
  wc.on('will-attach-webview', (e) => e.preventDefault())
}

/** Wipe whatever Chromium may have stored (caches, local storage) when the app closes. */
export async function wipeSessionData(): Promise<void> {
  try {
    await session.defaultSession.clearCache()
    await session.defaultSession.clearStorageData()
  } catch {
    /* best effort */
  }
}
