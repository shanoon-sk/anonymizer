import type { AnonymizeOptions, EntityType, FileResult, ProgressEvent } from './entities'

/** Remembered UI settings (no document data, no custom terms). */
export interface Preferences {
  types: EntityType[]
  outDir: string | null
}

/** API exposed to the renderer via contextBridge (window.anonymizer). */
export interface AnonymizerApi {
  /** Native file picker. Returns absolute paths. */
  pickFiles(): Promise<string[]>
  /** Folder picker for the output location. null = cancelled. */
  pickOutputDir(): Promise<string | null>
  /** Absolute path of a dropped File (Electron ≥ 32 no longer exposes File.path). */
  pathForFile(file: File): string
  /** Run anonymization. outDir null → next to each original file. */
  process(inputs: string[], options: AnonymizeOptions, outDir: string | null): Promise<FileResult[]>
  onProgress(cb: (e: ProgressEvent) => void): () => void
  showInFolder(path: string): Promise<void>
  openFile(path: string): Promise<void>
  openShanoon(): Promise<void>
  loadPreferences(): Promise<Preferences | null>
  savePreferences(p: Preferences): Promise<void>
  version: string
}

/** Messages between main process and the processing utility process. */
export type WorkerRequest = {
  kind: 'process'
  id: number
  inputs: string[]
  options: AnonymizeOptions
  outDir: string | null
}

export type WorkerResponse =
  | { kind: 'progress'; id: number; event: ProgressEvent }
  | { kind: 'result'; id: number; results: FileResult[] }
  | { kind: 'error'; id: number; message: string }
