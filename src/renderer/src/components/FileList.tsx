import { AlertTriangle, CheckCircle2, ExternalLink, FileSpreadsheet, FileText, FolderOpen, Loader2, X } from 'lucide-react'
import type { EntityType, FileResult, ProgressStage } from '../../../shared/entities'
import { sk, stageLabel, typeLabel } from '../i18n'
import { Button, cx } from './ui'

export interface FileItem {
  path: string
  name: string
  ext: string
  supported: boolean
  stage: ProgressStage | 'queued'
  progress: number
  detail?: string
  result?: FileResult
}

function FileIcon({ ext }: { ext: string }) {
  const cls = 'size-5'
  if (ext === 'xlsx' || ext === 'xlsm') return <FileSpreadsheet className={cx(cls, 'text-[#107c41] dark:text-[#4ade80]')} strokeWidth={1.75} />
  if (ext === 'pdf') return <FileText className={cx(cls, 'text-[#dc2626] dark:text-[#f87171]')} strokeWidth={1.75} />
  return <FileText className={cx(cls, 'text-[#2563eb] dark:text-[#60a5fa]')} strokeWidth={1.75} />
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

export function FileRow({ item, onRemove, busy }: { item: FileItem; onRemove: () => void; busy: boolean }) {
  const r = item.result
  const failed = item.stage === 'error' || !!r?.error || !item.supported
  const done = item.stage === 'done' && !failed
  const active = !done && !failed && item.stage !== 'queued'
  const counts = Object.entries(r?.counts ?? {}) as [EntityType, number][]
  const total = counts.reduce((n, [, c]) => n + c, 0)

  return (
    <li className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileIcon ext={item.ext} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-ink" title={item.path}>
            {item.name}
          </p>
          <p className={cx('mt-0.5 flex items-center gap-1.5 text-[12px]', failed ? 'text-danger' : done ? 'text-primary' : 'text-meta')}>
            {active && <Loader2 className="size-3.5 animate-spin" />}
            {done && <CheckCircle2 className="size-3.5" />}
            {failed && <AlertTriangle className="size-3.5" />}
            <span className="truncate">
              {!item.supported
                ? `${sk.unsupported}${['doc', 'xls'].includes(item.ext) ? ` – ${sk.legacyHint}` : ''}`
                : failed
                  ? r?.error ?? item.detail ?? sk.unexpected
                  : done
                    ? sk.found(total) + (r?.ocrPages ? ` · ${sk.ocrPages(r.ocrPages)}` : '')
                    : `${stageLabel[item.stage]}${item.detail && item.stage === 'ocr' ? ` ${item.detail}` : ''}`}
            </span>
          </p>
        </div>
        {done && r?.outputs[0] && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" onClick={() => window.anonymo.openFile(r.outputs[0])}>
              <ExternalLink className="size-3.5" />
              {sk.open}
            </Button>
            <Button size="sm" variant="ghost" title={sk.showInFolder} onClick={() => window.anonymo.showInFolder(r.outputs[0])}>
              <FolderOpen className="size-4" />
            </Button>
          </div>
        )}
        {!busy && !done && (
          <button
            onClick={onRemove}
            title={sk.remove}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-meta hover:bg-muted hover:text-ink"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {active && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.max(6, Math.round(stageProgress(item) * 100))}%` }}
          />
        </div>
      )}

      {done && counts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {counts
            .sort((a, b) => b[1] - a[1])
            .map(([t, c]) => (
              <span key={t} className="inline-flex items-center gap-1.5 rounded-md bg-primary-light px-2 py-0.5 text-[12px] text-primary">
                {typeLabel(t)}
                <span className="font-mono text-[11px] font-medium opacity-80">{c}</span>
              </span>
            ))}
        </div>
      )}
      {done && r && r.outputs.length > 1 && (
        <p className="mt-2 text-[12px] text-meta">
          + {r.outputs.slice(1).map(fileName).join(', ')}{' '}
          <button className="cursor-pointer text-primary hover:underline" onClick={() => window.anonymo.openFile(r.outputs[1])}>
            {sk.open}
          </button>
        </p>
      )}
      {done && r && r.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-gold">
          {r.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Overall 0..1 progress across stages, so the bar moves forward monotonically. */
function stageProgress(i: FileItem): number {
  const p = Math.min(1, Math.max(0, i.progress))
  switch (i.stage) {
    case 'reading':
      return 0.05
    case 'ocr':
      return 0.1 + p * 0.4
    case 'detecting':
      return 0.5 + p * 0.35
    case 'writing':
      return 0.9
    default:
      return 0
  }
}
