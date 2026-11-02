import type { EntityType } from '../shared/entities'

export type { EntityType }

/** A detected sensitive span inside a text segment. Offsets are UTF-16 indices, end exclusive. */
export interface Entity {
  type: EntityType
  start: number
  end: number
  score: number
  text: string
  source: string
}

export interface Recognizer {
  name: string
  types: EntityType[]
  find(text: string): Entity[]
}

/** A unit of text taken from a document (a paragraph, a cell, a PDF page…). */
export interface Segment {
  text: string
  /** Extra text that precedes the segment logically (e.g. a column header). Only used for context. */
  context?: string
  /** The whole segment is known to be this type (e.g. column "IČO"). */
  forceType?: EntityType
}

export interface ResolvedEntity extends Entity {
  placeholder: string
}

export interface SegmentResult {
  entities: ResolvedEntity[]
  output: string
}

/** Minimum score for an entity to be anonymized. */
export const SCORE_THRESHOLD = 0.5
