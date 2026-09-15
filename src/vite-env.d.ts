/// <reference types="vite/client" />

interface Window {
  seamforge?: {
    saveWav(bytes: Uint8Array<ArrayBuffer>, defaultName: string): Promise<string | null>
    aiStatus(): Promise<{ ready: boolean; label: string }>
    getSettings(): Promise<{
      processingDevice: 'cpu' | 'cuda'
      gpu: { available: boolean; name: string | null }
    }>
    saveSettings(settings: { processingDevice: 'cpu' | 'cuda' }): Promise<{ processingDevice: 'cpu' | 'cuda' }>
    separateVocals(bytes: Uint8Array<ArrayBuffer>): Promise<
      { ok: true; vocals: Uint8Array<ArrayBuffer> } | { ok: false; error: string }
    >
    onAiProgress(listener: (message: string) => void): () => void
  }
}
