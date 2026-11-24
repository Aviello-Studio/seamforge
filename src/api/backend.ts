import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open, save } from '@tauri-apps/plugin-dialog'
import type {
  AnalysisProgressEvent,
  AnalysisResult,
  AudioSummary,
  CrossfadeCurve,
  PlaybackState,
  SeamPreviewData,
  WavFormat,
} from './types'

export const AUDIO_EXTENSIONS = ['wav', 'flac', 'mp3', 'ogg', 'm4a', 'aac', 'aiff', 'aif', 'opus', 'wma']
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'm4v', '3gp', 'mpeg', 'mpg']
export const MEDIA_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS]

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function isSupportedAudioPath(path: string): boolean {
  const lower = path.toLowerCase()
  return MEDIA_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`))
}

export function isVideoPath(path: string): boolean {
  const lower = path.toLowerCase()
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`))
}

export interface PickAudioFileLabels {
  title?: string
  allMediaFilter?: string
  audioFilter?: string
  videoFilter?: string
}

export interface PickSaveWavLabels {
  title?: string
  wavFilter?: string
}

export async function pickAudioFile(labels?: PickAudioFileLabels): Promise<string | null> {
  if (!isTauriRuntime()) return null
  const result = await open({
    multiple: false,
    title: labels?.title ?? 'Open audio or video file',
    filters: [
      { name: labels?.allMediaFilter ?? 'Audio & Video', extensions: MEDIA_EXTENSIONS },
      { name: labels?.audioFilter ?? 'Audio files', extensions: AUDIO_EXTENSIONS },
      { name: labels?.videoFilter ?? 'Video files (extract audio)', extensions: VIDEO_EXTENSIONS },
    ],
  })
  return typeof result === 'string' ? result : null
}

export async function pickSaveWavPath(
  defaultName: string,
  labels?: PickSaveWavLabels,
): Promise<string | null> {
  if (!isTauriRuntime()) return null
  return save({
    title: labels?.title ?? 'Export seamless WAV loop',
    defaultPath: defaultName,
    filters: [{ name: labels?.wavFilter ?? 'WAV Audio', extensions: ['wav'] }],
  })
}

export async function loadAudio(path: string): Promise<AudioSummary> {
  return invoke<AudioSummary>('load_audio', { path })
}

export async function applyTrim(startSec: number, endSec: number): Promise<AudioSummary> {
  return invoke<AudioSummary>('apply_trim', { startSec, endSec })
}

export async function cancelTrim(): Promise<void> {
  return invoke<void>('cancel_trim')
}

export async function clearAudio(): Promise<void> {
  if (!isTauriRuntime()) return
  return invoke<void>('clear_audio')
}

export async function analyzeLoops(): Promise<AnalysisResult> {
  return invoke<AnalysisResult>('analyze_loops')
}

export async function cancelAnalysis(): Promise<void> {
  return invoke<void>('cancel_analysis')
}

export async function updateLoopParams(
  startSec: number,
  endSec: number,
  crossfadeMs: number,
  curve: CrossfadeCurve,
): Promise<SeamPreviewData> {
  return invoke<SeamPreviewData>('update_loop_params', {
    startSec,
    endSec,
    crossfadeMs,
    curve,
  })
}

export async function snapToZeroCrossing(timeSec: number, isEnd: boolean): Promise<number> {
  return invoke<number>('snap_to_zero_crossing', { timeSec, isEnd })
}

export async function playLoop(startFromSec?: number | null): Promise<PlaybackState> {
  return invoke<PlaybackState>('play_loop', { startFromSec: startFromSec ?? null })
}

export async function auditionSeam(leadSeconds = 2.5): Promise<PlaybackState> {
  return invoke<PlaybackState>('audition_seam', { leadSeconds })
}

export async function playTrimPreview(
  startSec: number,
  endSec: number,
  fromSec?: number | null,
): Promise<PlaybackState> {
  return invoke<PlaybackState>('play_trim_preview', {
    startSec,
    endSec,
    fromSec: fromSec ?? null,
  })
}

export async function pausePlayback(): Promise<PlaybackState> {
  return invoke<PlaybackState>('pause_playback')
}

export async function seekPlayback(positionSec: number): Promise<PlaybackState> {
  return invoke<PlaybackState>('seek_playback', { positionSec })
}

export async function getPlaybackState(): Promise<PlaybackState> {
  return invoke<PlaybackState>('get_playback_state')
}

export async function setPlaybackVolume(volume: number): Promise<number> {
  if (!isTauriRuntime()) return volume
  return invoke<number>('set_playback_volume', { volume })
}

export async function exportWav(outputPath: string, format: WavFormat): Promise<string> {
  return invoke<string>('export_wav', { outputPath, format })
}

export async function onAnalysisProgress(
  listener: (event: AnalysisProgressEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined
  return listen<AnalysisProgressEvent>('analysis-progress', (event) => listener(event.payload))
}

export async function onFileDrop(handlers: {
  onEnter?: () => void
  onLeave?: () => void
  onDrop: (paths: string[]) => void
}): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload
    if (payload.type === 'enter' || payload.type === 'over') handlers.onEnter?.()
    else if (payload.type === 'leave') handlers.onLeave?.()
    else if (payload.type === 'drop') {
      handlers.onLeave?.()
      handlers.onDrop(payload.paths)
    }
  })
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await getCurrentWindow().minimize()
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  if (!isTauriRuntime()) return false
  const win = getCurrentWindow()
  await win.toggleMaximize()
  return win.isMaximized()
}

export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauriRuntime()) return false
  return getCurrentWindow().isMaximized()
}

export async function closeWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await getCurrentWindow().close()
}
