import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('seamforge', {
  saveWav: (bytes: Uint8Array, defaultName: string) =>
    ipcRenderer.invoke('save-wav', bytes, defaultName) as Promise<string | null>,
  aiStatus: () => ipcRenderer.invoke('ai-status') as Promise<{ ready: boolean; label: string }>,
  getSettings: () => ipcRenderer.invoke('settings-get') as Promise<{
    processingDevice: 'cpu' | 'cuda'
    gpu: { available: boolean; name: string | null }
  }>,
  saveSettings: (settings: { processingDevice: 'cpu' | 'cuda' }) =>
    ipcRenderer.invoke('settings-save', settings) as Promise<{ processingDevice: 'cpu' | 'cuda' }>,
  separateVocals: (bytes: Uint8Array) => ipcRenderer.invoke('ai-separate-vocals', bytes) as Promise<
    { ok: true; vocals: Uint8Array } | { ok: false; error: string }
  >,
  generateBridges: (bytes: Uint8Array, maskStart: number, maskEnd: number, duration: number) =>
    ipcRenderer.invoke('ai-generate-bridges', bytes, maskStart, maskEnd, duration) as Promise<
      { ok: true; bridges: Uint8Array[] } | { ok: false; error: string }
    >,
  onAiProgress: (listener: (message: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, message: string) => listener(message)
    ipcRenderer.on('ai-progress', wrapped)
    return () => ipcRenderer.removeListener('ai-progress', wrapped)
  },
})
