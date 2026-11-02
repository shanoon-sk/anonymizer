import type { AnonymoApi } from './ipc'

declare global {
  const __APP_VERSION__: string
  interface Window {
    anonymo: AnonymoApi
  }
}
export {}
