import { Check } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'outline' | 'ghost'
export function Button({
  variant = 'outline',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-9 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        variant === 'primary' && 'bg-primary text-primary-fg hover:bg-primary-hover shadow-sm',
        variant === 'outline' && 'border border-border bg-surface text-ink hover:bg-muted',
        variant === 'ghost' && 'text-body hover:bg-muted hover:text-ink',
        className
      )}
    />
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <label
      className={cx(
        'group relative flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted',
        disabled && 'pointer-events-none opacity-50'
      )}
    >
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={cx(
          'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50',
          checked ? 'border-primary bg-primary text-primary-fg' : 'border-[color-mix(in_oklab,var(--meta)_45%,transparent)] bg-surface'
        )}
      >
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] leading-5 text-ink">{label}</span>
        {hint && <span className="block text-[12px] leading-4 text-meta">{hint}</span>}
      </span>
    </label>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-[var(--radius-card)] border border-border bg-surface', className)}>{children}</div>
}

/** Anonymo app mark: Shanoon teal rounded square with the Lucide "hat-glasses" glyph (same as resources/brand/icon.svg). */
export function AnonymoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <rect width="512" height="512" rx="115" fill="#0f766e" />
      <g
        transform="translate(106 106) scale(12.5)"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 18a2 2 0 0 0-4 0" />
        <path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11" />
        <path d="M2 11h20" />
        <circle cx="17" cy="18" r="3" />
        <circle cx="7" cy="18" r="3" />
      </g>
    </svg>
  )
}

/** Shanoon brand mark (teal rounded square with "SHN"), as on shanoon.sk. */
export function ShanoonMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <rect width="512" height="512" rx="115" fill="#0f766e" />
      <text
        x="256"
        y="318"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="700"
        fontSize="188"
        letterSpacing="-6"
        fill="#ffffff"
      >
        SHN
      </text>
    </svg>
  )
}
