export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (min > max) return Math.min(Math.max(value, max), min)
  return Math.min(Math.max(value, min), max)
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00.00'
  }
  const totalCs = Math.round(seconds * 100)
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const sec = totalSec % 60
  const min = Math.floor(totalSec / 60)
  return `${min}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function formatTimeDetailed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00.000'
  }
  const totalMs = Math.round(seconds * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const sec = totalSec % 60
  const min = Math.floor(totalSec / 60)
  return `${min}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

export function formatSampleRate(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) {
    return '0 Гц'
  }
  if (hz < 1000) {
    return `${Math.round(hz)} Гц`
  }
  const khz = hz / 1000
  if (Number.isInteger(khz)) {
    return `${khz} кГц`
  }
  return `${Number(khz.toFixed(2))} кГц`
}

export function defaultExportFileName(sourceName: string): string {
  const trimmed = sourceName.trim()
  if (!trimmed) {
    return 'loop-seamless.wav'
  }
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const fileOnly = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
  if (!fileOnly) {
    return 'loop-seamless.wav'
  }
  const dotIndex = fileOnly.lastIndexOf('.')
  const base = dotIndex > 0 ? fileOnly.slice(0, dotIndex) : fileOnly
  return `${base}-seamless.wav`
}
