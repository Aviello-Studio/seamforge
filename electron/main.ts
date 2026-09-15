import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { getAiRuntimeState, separateVocals } from './aiRuntime.js'

const here = dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: '#0b0d10',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d10', symbolColor: '#9ca3af', height: 44 },
    webPreferences: {
      preload: join(here, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL ?? (!app.isPackaged ? 'http://localhost:5173' : undefined)
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(here, '../dist/index.html'))
}

ipcMain.handle('save-wav', async (_event, bytes: Uint8Array, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Сохранить бесшовную петлю',
    defaultPath: defaultName,
    filters: [{ name: 'WAV audio', extensions: ['wav'] }],
  })
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, Buffer.from(bytes))
  return result.filePath
})

ipcMain.handle('ai-status', () => getAiRuntimeState(app.getPath('userData')))

ipcMain.handle('ai-separate-vocals', async (event, bytes: Uint8Array) => {
  const progress = (message: string) => event.sender.send('ai-progress', message)
  try {
    const vocals = await separateVocals(app.getPath('userData'), bytes, progress)
    return { ok: true as const, vocals }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка ИИ‑движка'
    return { ok: false as const, error: message }
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
