import { Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SELECTED } from '../../shared/entities'
import { sk } from './i18n'
import { DropZone } from './components/DropZone'
import { FileRow, type FileItem } from './components/FileList'
import { OutputLocation, TypeSelector, type Options } from './components/OptionsPanel'
import { AnonymoMark, Button, ShanoonMark } from './components/ui'

const SUPPORTED = new Set(['pdf', 'docx', 'xlsx', 'xlsm'])

function toItem(path: string): FileItem {
  const name = path.split(/[\\/]/).pop() ?? path
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return { path, name, ext, supported: SUPPORTED.has(ext), stage: 'queued', progress: 0 }
}

export function App() {
  const [files, setFiles] = useState<FileItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opts, setOpts] = useState<Options>({
    types: new Set(DEFAULT_SELECTED),
    customTerms: '',
    outDir: null
  })
  const [prefsLoaded, setPrefsLoaded] = useState(false)

  // Restore remembered settings (types, output folder) on start…
  useEffect(() => {
    window.anonymo
      .loadPreferences()
      .then((p) => {
        if (p) setOpts((o) => ({ ...o, types: new Set(p.types), outDir: p.outDir }))
      })
      .finally(() => setPrefsLoaded(true))
  }, [])
  // …and save them whenever they change. Custom terms are deliberately not stored.
  useEffect(() => {
    if (!prefsLoaded) return
    window.anonymo.savePreferences({ types: [...opts.types], outDir: opts.outDir })
  }, [prefsLoaded, opts.types, opts.outDir])

  useEffect(
    () =>
      window.anonymo.onProgress((e) =>
        setFiles((fs) => fs.map((f) => (f.path === e.input ? { ...f, stage: e.stage, progress: e.progress, detail: e.detail } : f)))
      ),
    []
  )

  const addPaths = (paths: string[]) => {
    setError(null)
    setFiles((fs) => {
      // Adding files after a finished batch starts a new one
      const base = fs.every((f) => f.stage === 'done' || f.stage === 'error') && fs.length ? [] : fs
      const known = new Set(base.map((f) => f.path))
      return [...base, ...paths.filter((p) => !known.has(p)).map(toItem)]
    })
  }

  const runnable = files.filter((f) => f.supported && f.stage === 'queued')
  const finished = files.length > 0 && files.every((f) => f.stage === 'done' || f.stage === 'error' || !f.supported)
  const hint = !runnable.length ? (finished ? null : sk.runHintNoFiles) : !opts.types.size && !opts.customTerms.trim() ? sk.runHintNoTypes : null

  const run = async () => {
    if (!runnable.length) return
    setBusy(true)
    setError(null)
    const inputs = runnable.map((f) => f.path)
    try {
      const results = await window.anonymo.process(
        inputs,
        {
          types: [...opts.types],
          customTerms: opts.customTerms.split('\n').map((s) => s.trim()).filter(Boolean),
          useNer: true,
          exportText: false
        },
        opts.outDir
      )
      setFiles((fs) =>
        fs.map((f) => {
          const r = results.find((x) => x.input === f.path)
          return r ? { ...f, result: r, stage: r.error ? 'error' : 'done', progress: 1 } : f
        })
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : sk.unexpected)
      setFiles((fs) => fs.map((f) => (inputs.includes(f.path) ? { ...f, stage: 'queued', progress: 0 } : f)))
    } finally {
      setBusy(false)
    }
  }

  const doneCount = useMemo(() => files.filter((f) => f.stage === 'done').length, [files])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <AnonymoMark className="size-9" />
          <div className="leading-tight">
            <h1 className="text-[17px] font-bold tracking-tight text-ink">{sk.appName}</h1>
            <p className="text-[12px] text-meta">{sk.by}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--primary)_25%,transparent)] bg-primary-light px-3 py-1 text-[12px] font-medium text-primary">
          <ShieldCheck className="size-3.5" />
          {sk.offlineBadge}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Main: drop zone stays put, only the file list scrolls */}
        <main className="flex min-w-0 flex-1 flex-col px-6 pt-6 pb-4">
          <div className="shrink-0">
            <DropZone onPaths={addPaths} compact={files.length > 0} disabled={busy} />
          </div>
          <div className="mt-3">
            <OutputLocation value={opts} onChange={setOpts} disabled={busy} />
          </div>

          {files.length > 0 && (
            <section className="mt-6 flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex shrink-0 items-center justify-between">
                <h2 className="text-[12px] font-semibold tracking-wide text-meta uppercase">
                  {sk.filesHeading} <span className="font-mono">({files.length})</span>
                </h2>
                {!busy && (
                  <button className="cursor-pointer text-[12px] font-medium text-meta hover:text-ink" onClick={() => setFiles([])}>
                    {finished ? sk.newBatch : sk.clearFiles}
                  </button>
                )}
              </div>
              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {files.map((f) => (
                  <FileRow key={f.path} item={f} busy={busy} onRemove={() => setFiles((fs) => fs.filter((x) => x.path !== f.path))} />
                ))}
              </ul>
              {doneCount > 0 && (
                <p className="mt-3 flex shrink-0 items-center gap-2 text-[13px] text-meta">
                  <Sparkles className="size-4 text-gold" />
                  {sk.reviewNote}
                </p>
              )}
            </section>
          )}

          {error && <p className="mt-4 shrink-0 rounded-lg bg-danger-bg px-4 py-3 text-[13px] text-danger">{error}</p>}
        </main>

        {/* Options */}
        <aside className="flex min-h-0 w-[340px] shrink-0 flex-col border-l border-border bg-muted/40">
          <TypeSelector value={opts} onChange={setOpts} disabled={busy} />
          <div className="shrink-0 border-t border-border p-4">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={busy || !runnable.length || (!opts.types.size && !opts.customTerms.trim())}
              onClick={run}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {busy ? sk.running : sk.run}
            </Button>
            {hint && <p className="mt-2 text-center text-[12px] text-meta">{hint}</p>}
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="flex h-11 shrink-0 items-center justify-between border-t border-border px-6 text-[12px] text-meta">
        <span className="truncate pr-4">{sk.privacy}</span>
        <button onClick={() => window.anonymo.openShanoon()} className="group flex shrink-0 cursor-pointer items-center gap-2 hover:text-ink">
          <span>{sk.poweredBy}</span>
          <ShanoonMark className="size-4" />
          <span className="font-semibold tracking-wide text-ink group-hover:text-primary">SHANOON</span>
          <span className="font-mono text-[11px] opacity-60">v{window.anonymo.version}</span>
        </button>
      </footer>
    </div>
  )
}
