/// <reference types="vite/client" />

interface Window {
  seamforge?: {
    saveWav(bytes: Uint8Array<ArrayBuffer>, defaultName: string): Promise<string | null>
    aiStatus(): Promise<{ ready: boolean; label: string }>
    separateVocals(bytes: Uint8Array<ArrayBuffer>): Promise<
      { ok: true; vocals: Uint8Array<ArrayBuffer> } | { ok: false; error: string }
    >
    onAiProgress(listener: (message: string) => void): () => void
  }
}
