import { FileUp } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { sk } from '../i18n'
import { Button, cx } from './ui'

export function DropZone({ onPaths, compact, disabled }: { onPaths: (paths: string[]) => void; compact?: boolean; disabled?: boolean }) {
  const [over, setOver] = useState(false)
  const [, setDepth] = useState(0)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    setDepth(0)
    if (disabled) return
    const paths = [...e.dataTransfer.files].map((f) => window.anonymizer.pathForFile(f)).filter(Boolean)
    if (paths.length) onPaths(paths)
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault()
        setDepth((d) => {
          if (d === 0) setOver(true)
          return d + 1
        })
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        setDepth((d) => {
          if (d <= 1) setOver(false)
          return Math.max(0, d - 1)
        })
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={cx(
        'relative flex items-center rounded-[var(--radius-card)] border-2 border-dashed transition-[background-color,border-color,transform]',
        compact ? 'flex-row gap-4 px-5 py-3.5 text-left' : 'flex-col justify-center gap-4 px-8 py-14 text-center',
        over ? 'border-primary bg-primary-light scale-[1.005]' : 'border-border bg-muted/60 hover:border-[color-mix(in_oklab,var(--primary)_40%,var(--border))]',
        disabled && 'opacity-60'
      )}
    >
      <div
        className={cx(
          'flex items-center justify-center rounded-2xl bg-primary-light text-primary transition-transform',
          compact ? 'size-10' : 'size-14',
          over && 'scale-110'
        )}
      >
        <FileUp className={compact ? 'size-5' : 'size-7'} strokeWidth={1.75} />
      </div>
      <div className={cx(compact && 'min-w-0 flex-1')}>
        <p className={cx('font-semibold text-ink', compact ? 'text-[15px]' : 'text-lg')}>{over ? sk.dropActive : sk.dropTitle}</p>
        <p className={cx('text-meta', compact ? 'text-[13px]' : 'mt-1 text-sm')}>{sk.dropSubtitle}</p>
      </div>
      {!over && (
        <div className="flex items-center gap-3 text-sm text-meta">
          {!compact && <span>{sk.dropOr}</span>}
          <Button
            size={compact ? 'sm' : 'md'}
            disabled={disabled}
            onClick={async () => {
              const paths = await window.anonymizer.pickFiles()
              if (paths.length) onPaths(paths)
            }}
          >
            {sk.pickFiles}
          </Button>
        </div>
      )}
    </div>
  )
}
