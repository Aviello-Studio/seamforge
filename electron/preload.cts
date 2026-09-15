import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('seamforge', {
  saveWav: (bytes: Uint8Array, defaultName: string) =>
    ipcRenderer.invoke('save-wav', bytes, defaultName) as Promise<string | null>,
  aiStatus: () => ipcRenderer.invoke('ai-status') as Promise<{ ready: boolean; label: string }>,
  separateVocals: (bytes: Uint8Array) => ipcRenderer.invoke('ai-separate-vocals', bytes) as Promise<
    { ok: true; vocals: Uint8Array } | { ok: false; error: string }
  >,
  onAiProgress: (listener: (message: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, message: string) => listener(message)
    ipcRenderer.on('ai-progress', wrapped)
    return () => ipcRenderer.removeListener('ai-progress', wrapped)
  },
})
