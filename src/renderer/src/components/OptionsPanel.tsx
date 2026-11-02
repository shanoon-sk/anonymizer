import { Folder } from 'lucide-react'
import { ENTITY_GROUPS, type EntityType } from '../../../shared/entities'
import { sk } from '../i18n'
import { Checkbox } from './ui'

export interface Options {
  types: Set<EntityType>
  customTerms: string
  outDir: string | null
}

const ALL_TYPES = ENTITY_GROUPS.flatMap((g) => g.items.map((i) => i.type))

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-2">
      <h2 className="text-[12px] font-semibold tracking-wide text-meta uppercase">{children}</h2>
      {action}
    </div>
  )
}

interface PanelProps {
  value: Options
  onChange: (o: Options) => void
  disabled?: boolean
}

/** Data types to hide – the only scrollable part of the sidebar. */
export function TypeSelector({ value, onChange, disabled }: PanelProps) {
  const toggle = (t: EntityType, on: boolean) => {
    const types = new Set(value.types)
    if (on) types.add(t)
    else types.delete(t)
    onChange({ ...value, types })
  }
  const allOn = ALL_TYPES.every((t) => value.types.has(t))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-5">
        <SectionTitle
          action={
            <button
              disabled={disabled}
              className="cursor-pointer text-[12px] font-medium text-primary hover:underline disabled:opacity-50"
              onClick={() => onChange({ ...value, types: allOn ? new Set() : new Set(ALL_TYPES) })}
            >
              {allOn ? sk.selectNone : sk.selectAll}
            </button>
          }
        >
          {sk.whatToHide}
        </SectionTitle>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4">
        {ENTITY_GROUPS.map((g) => {
          const groupOn = g.items.every((i) => value.types.has(i.type))
          return (
            <div key={g.id}>
              <button
                disabled={disabled}
                onClick={() => {
                  const types = new Set(value.types)
                  g.items.forEach((i) => (groupOn ? types.delete(i.type) : types.add(i.type)))
                  onChange({ ...value, types })
                }}
                className="mb-0.5 cursor-pointer px-2 text-[13px] font-semibold text-ink hover:text-primary"
                title={groupOn ? sk.selectNone : sk.selectAll}
              >
                {g.label}
              </button>
              {g.items.map((i) => (
                <Checkbox
                  key={i.type}
                  disabled={disabled}
                  checked={value.types.has(i.type)}
                  onChange={(on) => toggle(i.type, on)}
                  label={i.label}
                  hint={i.hint}
                />
              ))}
            </div>
          )
        })}
        <div>
          <p className="mb-1 px-2 text-[13px] font-semibold text-ink">{sk.customTerms}</p>
          <div className="px-2">
            <textarea
              disabled={disabled}
              value={value.customTerms}
              onChange={(e) => onChange({ ...value, customTerms: e.target.value })}
              placeholder={sk.customTermsPlaceholder}
              rows={3}
              spellCheck={false}
              className="block w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-meta/70 focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-[12px] leading-4 text-meta">{sk.customTermsHint}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Output location – shown under the drop zone. */
export function OutputLocation({ value, onChange, disabled }: PanelProps) {
  return (
    <div className="shrink-0">
      <div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2" title={value.outDir ?? sk.saveNextTo}>
          <Folder className="size-4 shrink-0 text-meta" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-body">
            <span className="text-meta">{sk.saveTo}: </span>
            {value.outDir ?? sk.saveNextTo}
          </span>
          <button
            disabled={disabled}
            className="shrink-0 cursor-pointer text-[12px] font-medium text-primary hover:underline disabled:opacity-50"
            onClick={async () => {
              if (value.outDir) return onChange({ ...value, outDir: null })
              const dir = await window.anonymo.pickOutputDir()
              if (dir) onChange({ ...value, outDir: dir })
            }}
          >
            {value.outDir ? sk.reset : sk.change}
          </button>
        </div>
      </div>
    </div>
  )
}
