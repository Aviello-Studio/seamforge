import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('seamforge', {
  saveWav: (bytes: Uint8Array, defaultName: string) =>
    ipcRenderer.invoke('save-wav', bytes, defaultName) as Promise<string | null>,
})
