import type { Segment, SegmentResult } from '../types'

/** A loaded document: its text segments plus a writer that produces the anonymized file. */
export interface DocumentAdapter {
  segments: Segment[]
  write(results: SegmentResult[]): Promise<Uint8Array>
  /** Optional plain-text/Markdown rendering of the anonymized content (used for PDFs). */
  toText?(results: SegmentResult[]): string
  outputExt: string
  /** Pages that went through OCR (PDF only) */
  ocrPages?: number
  warnings?: string[]
}

export type SupportedKind = 'pdf' | 'docx' | 'xlsx'

export function kindFromName(name: string): SupportedKind | null {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'pdf' || ext === 'docx' || ext === 'xlsx') return ext
  if (ext === 'xlsm') return 'xlsx'
  return null
}
