import type { AnonymizerApi } from './ipc'

declare global {
  const __APP_VERSION__: string
  interface Window {
    anonymizer: AnonymizerApi
  }
}
export {}
