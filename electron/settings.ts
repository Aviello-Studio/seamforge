import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ProcessingDevice = 'cpu' | 'cuda'

export type AppSettings = {
  processingDevice: ProcessingDevice
}

const defaults: AppSettings = { processingDevice: 'cpu' }

export function normalizeSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') return defaults
  const device = (value as { processingDevice?: unknown }).processingDevice
  return { processingDevice: device === 'cuda' ? 'cuda' : 'cpu' }
}

export async function loadSettings(userData: string): Promise<AppSettings> {
  try {
    return normalizeSettings(JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')))
  } catch {
    return defaults
  }
}

export async function saveSettings(userData: string, value: unknown): Promise<AppSettings> {
  const settings = normalizeSettings(value)
  await writeFile(join(userData, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`)
  return settings
}
