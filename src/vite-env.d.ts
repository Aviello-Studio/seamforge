/// <reference types="vite/client" />

interface Window {
  seamforge?: {
    saveWav(bytes: Uint8Array<ArrayBuffer>, defaultName: string): Promise<string | null>
  }
}
