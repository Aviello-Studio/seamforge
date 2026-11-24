import { useCallback, useEffect, useRef, useState } from 'react'
import {
  analyzeLoops,
  applyTrim,
  auditionSeam,
  cancelAnalysis,
  cancelTrim,
  clearAudio,
  exportWav,
  getPlaybackState,
  isSupportedAudioPath,
  isTauriRuntime,
  isVideoPath,
  loadAudio,
  onAnalysisProgress,
  onFileDrop,
  pausePlayback,
  pickAudioFile,
  pickSaveWavPath,
  playLoop,
  playTrimPreview,
  seekPlayback,
  setPlaybackVolume,
  snapToZeroCrossing,
  updateLoopParams,
} from './api/backend'
import type {
  AudioSummary,
  CrossfadeCurve,
  LoopCandidate,
  PlaybackMode,
  SeamPreviewData,
  WavFormat,
} from './api/types'
import { CandidateSidebar } from './components/CandidateSidebar'
import { ConfirmDialog } from './components/ConfirmDialog'
import { EmptyDropzone } from './components/EmptyDropzone'
import { SeamInspector } from './components/SeamInspector'
import { TitleBar } from './components/TitleBar'
import { TransportBar } from './components/TransportBar'
import { TrimModal } from './components/TrimModal'
import { WaveformCanvas } from './components/WaveformCanvas'
import { clamp, defaultExportFileName, formatSampleRate, formatTime } from './lib/format'

type ConfirmAction =
  | { type: 'clear' }
  | { type: 'replace'; path: string; fileName: string }

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function App() {
  const [audio, setAudio] = useState<AudioSummary | null>(null)
  const [pendingAudio, setPendingAudio] = useState<AudioSummary | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoadingFile, setIsLoadingFile] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [crossfadeMs, setCrossfadeMs] = useState(40)
  const [curve, setCurve] = useState<CrossfadeCurve>('constantGain')
  const [seamPreview, setSeamPreview] = useState<SeamPreviewData | null>(null)

  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressStage, setProgressStage] = useState('')
  const [bpm, setBpm] = useState<number | null>(null)
  const [beatsPerBar, setBeatsPerBar] = useState<number | null>(null)
  const [beatTimes, setBeatTimes] = useState<number[]>([])
  const [showBeats, setShowBeats] = useState(true)
  const [candidates, setCandidates] = useState<LoopCandidate[]>([])
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('idle')
  const [audioAvailable, setAudioAvailable] = useState(true)
  const [volume, setVolume] = useState<number>(() => {
    try {
      const saved = window.localStorage.getItem('seamforge.volume')
      const parsed = saved === null ? Number.NaN : Number(saved)
      return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 0.85
    } catch {
      return 0.85
    }
  })
  const [muted, setMuted] = useState(false)
  const [exportFormat, setExportFormat] = useState<WavFormat>('pcm24')
  const [exporting, setExporting] = useState(false)
  const [statusText, setStatusText] = useState('Готово к работе')

  const playheadRef = useRef(0)
  const loopOffsetRef = useRef(0)
  const analysisRunIdRef = useRef(0)
  const seamUpdateTimerRef = useRef<number | null>(null)
  const seamRequestIdRef = useRef(0)

  const duration = audio?.duration ?? 0
  const maxCrossfadeMs = Math.min(1000, Math.max(20, Math.floor(Math.max(0.1, end - start) * 450)))
  const effectiveCrossfadeMs = clamp(crossfadeMs, 5, maxCrossfadeMs)
  const loopDuration = seamPreview?.loopDuration ?? Math.max(0, end - start - effectiveCrossfadeMs / 1000)

  const syncSeamNow = useCallback(
    async (nextStart: number, nextEnd: number, nextFadeMs: number, nextCurve: CrossfadeCurve) => {
      if (!isTauriRuntime()) return
      const reqId = ++seamRequestIdRef.current
      try {
        const preview = await updateLoopParams(nextStart, nextEnd, nextFadeMs, nextCurve)
        if (reqId === seamRequestIdRef.current) {
          setSeamPreview(preview)
        }
      } catch (error) {
        if (reqId === seamRequestIdRef.current) {
          setStatusText(`Ошибка пересчёта стыка: ${String(error)}`)
        }
      }
    },
    [],
  )

  const scheduleSeamSync = useCallback(
    (nextStart: number, nextEnd: number, nextFadeMs: number, nextCurve: CrossfadeCurve) => {
      if (seamUpdateTimerRef.current !== null) {
        window.clearTimeout(seamUpdateTimerRef.current)
      }
      seamUpdateTimerRef.current = window.setTimeout(() => {
        seamUpdateTimerRef.current = null
        void syncSeamNow(nextStart, nextEnd, nextFadeMs, nextCurve)
      }, 45)
    },
    [syncSeamNow],
  )

  useEffect(() => {
    return () => {
      if (seamUpdateTimerRef.current !== null) {
        window.clearTimeout(seamUpdateTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    void setPlaybackVolume(muted ? 0 : volume).catch(() => undefined)
    try {
      window.localStorage.setItem('seamforge.volume', volume.toFixed(2))
    } catch {
      // Ignore storage errors
    }
  }, [muted, volume])

  const handleChangeVolume = useCallback((nextVolume: number) => {
    const clamped = clamp(nextVolume, 0, 1)
    setVolume(clamped)
    if (clamped > 0) setMuted(false)
  }, [])

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      if (prev && volume <= 0.001) setVolume(0.5)
      return !prev
    })
  }, [volume])

  // Subscribe to backend analysis progress events
  useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    void onAnalysisProgress((payload) => {
      if (!active) return
      setProgress(payload.progress)
      setProgressStage(payload.stage)
    }).then((fn) => {
      if (!active) fn()
      else unlisten = fn
    })
    return () => {
      active = false
      unlisten?.()
    }
  }, [])

  // Poll native audio playhead smoothly while playing (updates ref, never re-renders App at 60 FPS)
  useEffect(() => {
    if (!isPlaying || !isTauriRuntime()) return
    let stopped = false
    let timerId = 0

    const poll = async () => {
      if (stopped) return
      try {
        const state = await getPlaybackState()
        if (stopped) return
        playheadRef.current = state.positionSec
        loopOffsetRef.current = state.loopOffsetSec
        setAudioAvailable(state.audioAvailable)
        if (!state.playing) {
          setIsPlaying(false)
          setPlaybackMode(state.mode)
          return
        }
      } catch {
        // Ignore transient poll errors during shutdown
      }
      if (!stopped) {
        timerId = window.setTimeout(() => void poll(), 24)
      }
    }

    void poll()
    return () => {
      stopped = true
      window.clearTimeout(timerId)
    }
  }, [isPlaying])

  const openPath = useCallback(
    async (path: string) => {
      if (!isSupportedAudioPath(path)) {
        setLoadError('Неподдерживаемый формат. Поддерживаются WAV, FLAC, MP3, OGG, M4A, AAC и видео MP4, MOV, MKV, WebM, AVI, WMV.')
        return
      }
      if (analyzing) {
        analysisRunIdRef.current += 1
        setAnalyzing(false)
        await cancelAnalysis().catch(() => undefined)
      }
      await pausePlayback().catch(() => undefined)
      setIsPlaying(false)
      setPlaybackMode('idle')
      setIsLoadingFile(true)
      setLoadError(null)
      setStatusText(isVideoPath(path) ? 'Извлечение аудиодорожки из видео…' : 'Декодирование аудиофайла…')
      try {
        const summary = await loadAudio(path)
        playheadRef.current = 0
        setPendingAudio(summary)
        setStatusText(`Открыт ${summary.fileName} · выберите фрагмент или используйте целиком`)
      } catch (error) {
        const message = typeof error === 'string' ? error : error instanceof Error ? error.message : 'Не удалось декодировать файл'
        setLoadError(message)
        setStatusText(`Ошибка загрузки: ${message}`)
      } finally {
        setIsLoadingFile(false)
      }
    },
    [analyzing],
  )

  const handleOpenFile = useCallback(async () => {
    if (isLoadingFile) return
    try {
      const path = await pickAudioFile()
      if (path) await openPath(path)
    } catch (error) {
      setLoadError(`Не удалось открыть диалог: ${String(error)}`)
    }
  }, [isLoadingFile, openPath])

  const handleClearProject = useCallback(async () => {
    analysisRunIdRef.current += 1
    seamRequestIdRef.current += 1
    if (seamUpdateTimerRef.current !== null) {
      window.clearTimeout(seamUpdateTimerRef.current)
      seamUpdateTimerRef.current = null
    }
    setAnalyzing(false)
    setProgress(0)
    setProgressStage('')
    setIsPlaying(false)
    setPlaybackMode('idle')
    await clearAudio().catch(() => undefined)
    playheadRef.current = 0
    loopOffsetRef.current = 0
    setAudio(null)
    setPendingAudio(null)
    setSeamPreview(null)
    setStart(0)
    setEnd(0)
    setCrossfadeMs(40)
    setCurve('constantGain')
    setBpm(null)
    setBeatsPerBar(null)
    setBeatTimes([])
    setCandidates([])
    setSelectedCandidateId(null)
    setLoadError(null)
    setStatusText('Готово к работе')
  }, [])

  const handleConfirmAction = useCallback(async () => {
    const action = confirmAction
    if (!action) return
    setConfirmAction(null)
    if (action.type === 'clear') {
      await handleClearProject()
    } else {
      await openPath(action.path)
    }
  }, [confirmAction, handleClearProject, openPath])

  // Subscribe to native Tauri OS drag-and-drop
  useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    void onFileDrop({
      onEnter: () => setIsDragging(true),
      onLeave: () => setIsDragging(false),
      onDrop: (paths) => {
        setIsDragging(false)
        if (isLoadingFile) return
        const first = paths[0]
        if (!first) return
        if (!isSupportedAudioPath(first)) {
          const message = 'Неподдерживаемый формат. Поддерживаются WAV, FLAC, MP3, OGG, M4A, AAC и видео MP4, MOV, MKV, WebM, AVI, WMV.'
          if (!audio) setLoadError(message)
          setStatusText(message)
          return
        }
        if (audio || pendingAudio) {
          setConfirmAction({
            type: 'replace',
            path: first,
            fileName: fileNameFromPath(first),
          })
        } else {
          void openPath(first)
        }
      },
    }).then((fn) => {
      if (!active) fn()
      else unlisten = fn
    })
    return () => {
      active = false
      unlisten?.()
    }
  }, [audio, isLoadingFile, openPath, pendingAudio])

  const handleCancelTrim = useCallback(async () => {
    await pausePlayback().catch(() => undefined)
    await cancelTrim().catch(() => undefined)
    setIsPlaying(false)
    setPlaybackMode('idle')
    setPendingAudio(null)
    setStatusText(audio ? 'Обрезка отменена' : 'Готово к работе')
  }, [audio])

  const handleConfirmTrim = useCallback(
    async (trimStart: number, trimEnd: number) => {
      await pausePlayback().catch(() => undefined)
      setIsPlaying(false)
      setPlaybackMode('idle')
      try {
        const trimmed = await applyTrim(trimStart, trimEnd)
        setPendingAudio(null)
        setAudio(trimmed)
        setStart(0)
        setEnd(trimmed.duration)
        setCrossfadeMs(40)
        setCurve('constantGain')
        setCandidates([])
        setSelectedCandidateId(null)
        setBpm(null)
        setBeatsPerBar(null)
        setBeatTimes([])
        playheadRef.current = 0
        loopOffsetRef.current = 0
        setStatusText(
          `${trimmed.channels === 1 ? 'Моно' : `${trimmed.channels} кан.`} · ${formatSampleRate(trimmed.sampleRate)}${trimmed.bitDepth ? ` · ${trimmed.bitDepth}-bit` : ''} · ${formatTime(trimmed.duration)}`,
        )
        await syncSeamNow(0, trimmed.duration, 40, 'constantGain')
      } catch (error) {
        setStatusText(`Ошибка обрезки: ${String(error)}`)
      }
    },
    [syncSeamNow],
  )

  const handleSelectCandidate = useCallback(
    async (candidate: LoopCandidate) => {
      setSelectedCandidateId(candidate.id)
      setStart(candidate.start)
      setEnd(candidate.end)
      setCrossfadeMs(candidate.crossfadeMs)
      setCurve(candidate.curve)
      await syncSeamNow(candidate.start, candidate.end, candidate.crossfadeMs, candidate.curve)
      const auditionPoint = Math.max(
        candidate.start,
        candidate.end - Math.min(2.5, (candidate.end - candidate.start) * 0.35),
      )
      playheadRef.current = auditionPoint
      loopOffsetRef.current = Math.max(0, auditionPoint - candidate.start)
      if (isPlaying) {
        const state = await playLoop(auditionPoint).catch(() => null)
        if (state) {
          setIsPlaying(state.playing)
          setPlaybackMode(state.mode)
          playheadRef.current = state.positionSec
          loopOffsetRef.current = state.loopOffsetSec
        }
      }
      setStatusText(
        `Вариант #${candidate.id + 1}: уверенность ${candidate.confidence}%, петля ${formatTime(candidate.loopDuration)}`,
      )
    },
    [isPlaying, syncSeamNow],
  )

  const handleAnalyze = useCallback(async () => {
    if (!audio || analyzing) return
    const runId = ++analysisRunIdRef.current
    setAnalyzing(true)
    setProgress(0.02)
    setProgressStage('Подготовка анализа…')
    setStatusText('Многопоточный музыкальный анализ…')
    try {
      const result = await analyzeLoops()
      if (runId !== analysisRunIdRef.current) return
      setBpm(result.bpm)
      setBeatsPerBar(result.beatsPerBar)
      setBeatTimes(result.beatTimes)
      setCandidates(result.candidates)
      if (result.candidates.length > 0) {
        const best = result.candidates[0]
        setSelectedCandidateId(best.id)
        setStart(best.start)
        setEnd(best.end)
        setCrossfadeMs(best.crossfadeMs)
        setCurve(best.curve)
        await syncSeamNow(best.start, best.end, best.crossfadeMs, best.curve)
        playheadRef.current = Math.max(best.start, best.end - Math.min(2.5, (best.end - best.start) * 0.35))
        loopOffsetRef.current = Math.max(0, playheadRef.current - best.start)
        setStatusText(
          `Найдено вариантов: ${result.candidates.length} · ${result.bpm.toFixed(1)} BPM (${result.beatsPerBar}/4) · лучший ${best.confidence}%`,
        )
      } else {
        setStatusText('Подходящие музыкальные стыки не найдены')
      }
    } catch (error) {
      if (runId === analysisRunIdRef.current) {
        const msg = String(error)
        if (msg.includes('отменён')) {
          setStatusText('Анализ отменён')
        } else {
          setStatusText(`Ошибка анализа: ${msg}`)
        }
      }
    } finally {
      if (runId === analysisRunIdRef.current) {
        setAnalyzing(false)
        setProgress(0)
        setProgressStage('')
      }
    }
  }, [analyzing, audio, syncSeamNow])

  const handleCancelAnalysis = useCallback(async () => {
    analysisRunIdRef.current += 1
    setAnalyzing(false)
    setProgress(0)
    setProgressStage('')
    await cancelAnalysis().catch(() => undefined)
    setStatusText('Анализ отменён')
  }, [])

  const handleChangeBounds = useCallback(
    (nextStart: number, nextEnd: number) => {
      if (!audio) return
      const s = clamp(nextStart, 0, Math.max(0, audio.duration - 0.1))
      const e = clamp(nextEnd, s + 0.1, audio.duration)
      const nextMaxFade = Math.min(1000, Math.max(20, Math.floor((e - s) * 450)))
      const nextFade = clamp(crossfadeMs, 5, nextMaxFade)
      setStart(s)
      setEnd(e)
      if (nextFade !== crossfadeMs) setCrossfadeMs(nextFade)
      setSelectedCandidateId(null)
      scheduleSeamSync(s, e, nextFade, curve)
    },
    [audio, crossfadeMs, curve, scheduleSeamSync],
  )

  const handleChangeStart = useCallback(
    (nextStart: number) => {
      handleChangeBounds(Math.min(nextStart, end - 0.1), end)
    },
    [end, handleChangeBounds],
  )

  const handleChangeEnd = useCallback(
    (nextEnd: number) => {
      handleChangeBounds(start, Math.max(nextEnd, start + 0.1))
    },
    [handleChangeBounds, start],
  )

  const handleSnapBoundary = useCallback(
    async (which: 'start' | 'end') => {
      if (!audio) return
      try {
        const snapped = await snapToZeroCrossing(which === 'start' ? start : end, which === 'end')
        if (which === 'start') handleChangeStart(snapped)
        else handleChangeEnd(snapped)
        setStatusText(`Точка ${which === 'start' ? 'начала' : 'конца'} привязана к zero crossing`)
      } catch (error) {
        setStatusText(`Ошибка привязки: ${String(error)}`)
      }
    },
    [audio, end, handleChangeEnd, handleChangeStart, start],
  )

  const handleChangeCrossfade = useCallback(
    (ms: number) => {
      const clamped = clamp(ms, 5, maxCrossfadeMs)
      setCrossfadeMs(clamped)
      setSelectedCandidateId(null)
      scheduleSeamSync(start, end, clamped, curve)
    },
    [curve, end, maxCrossfadeMs, scheduleSeamSync, start],
  )

  const handleChangeCurve = useCallback(
    (nextCurve: CrossfadeCurve) => {
      if (nextCurve === curve) return
      setCurve(nextCurve)
      setSelectedCandidateId(null)
      void syncSeamNow(start, end, effectiveCrossfadeMs, nextCurve)
    },
    [curve, effectiveCrossfadeMs, end, start, syncSeamNow],
  )

  const handleTogglePlay = useCallback(async () => {
    if (!audio) return
    try {
      if (isPlaying && playbackMode === 'loop') {
        const state = await pausePlayback()
        setIsPlaying(state.playing)
        setPlaybackMode(state.mode)
        setAudioAvailable(state.audioAvailable)
        playheadRef.current = state.positionSec
        loopOffsetRef.current = state.loopOffsetSec
      } else {
        const from =
          playheadRef.current >= start && playheadRef.current < end
            ? playheadRef.current
            : Math.max(start, end - Math.min(2.5, (end - start) * 0.35))
        const state = await playLoop(from)
        setIsPlaying(state.playing)
        setPlaybackMode(state.mode)
        setAudioAvailable(state.audioAvailable)
        playheadRef.current = state.positionSec
        loopOffsetRef.current = state.loopOffsetSec
      }
    } catch (error) {
      setStatusText(`Ошибка воспроизведения: ${String(error)}`)
    }
  }, [audio, end, isPlaying, playbackMode, start])

  const handleAuditionSeam = useCallback(async () => {
    if (!audio) return
    try {
      const state = await auditionSeam(2.5)
      setIsPlaying(state.playing)
      setPlaybackMode(state.mode)
      setAudioAvailable(state.audioAvailable)
      playheadRef.current = state.positionSec
      loopOffsetRef.current = state.loopOffsetSec
      setStatusText('Прослушивание стыка (за 2.5 с до склейки)')
    } catch (error) {
      setStatusText(`Ошибка прослушивания стыка: ${String(error)}`)
    }
  }, [audio])

  const handleSeek = useCallback(
    async (timeSec: number) => {
      if (!audio) return
      const clamped = clamp(timeSec, start, end)
      playheadRef.current = clamped
      loopOffsetRef.current = clamp(clamped - start, 0, Math.max(0, loopDuration))
      if (isPlaying && playbackMode === 'loop') {
        try {
          const state = await seekPlayback(clamped)
          playheadRef.current = state.positionSec
          loopOffsetRef.current = state.loopOffsetSec
        } catch {
          // Ignore seek race
        }
      }
    },
    [audio, end, isPlaying, loopDuration, playbackMode, start],
  )

  const handleTrimPlayPreview = useCallback(async (trimStart: number, trimEnd: number, fromSec?: number) => {
    try {
      const state = await playTrimPreview(trimStart, trimEnd, fromSec ?? trimStart)
      setIsPlaying(state.playing)
      setPlaybackMode(state.mode)
      setAudioAvailable(state.audioAvailable)
      playheadRef.current = state.positionSec
    } catch (error) {
      setStatusText(`Ошибка прослушивания: ${String(error)}`)
    }
  }, [])

  const handleTrimPausePreview = useCallback(async () => {
    try {
      const state = await pausePlayback()
      setIsPlaying(state.playing)
      setPlaybackMode(state.mode)
      playheadRef.current = state.positionSec
    } catch {
      setIsPlaying(false)
    }
  }, [])

  const handleExport = useCallback(async () => {
    if (!audio || exporting) return
    try {
      const suggested = defaultExportFileName(audio.fileName)
      const outputPath = await pickSaveWavPath(suggested)
      if (!outputPath) {
        setStatusText('Экспорт отменён')
        return
      }
      setExporting(true)
      setStatusText('Запись WAV в оригинальной частоте…')
      const saved = await exportWav(outputPath, exportFormat)
      setStatusText(`Сохранено: ${saved}`)
    } catch (error) {
      setStatusText(`Ошибка экспорта: ${String(error)}`)
    } finally {
      setExporting(false)
    }
  }, [audio, exportFormat, exporting])

  // Global studio keyboard shortcuts when no modal is open
  useEffect(() => {
    if (pendingAudio || confirmAction) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isInput = Boolean(target?.matches('input, select, textarea, button'))

      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyO') {
        event.preventDefault()
        void handleOpenFile()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
        if (!audio) return
        event.preventDefault()
        void handleExport()
        return
      }
      if (isInput || !audio) return

      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault()
        void handleTogglePlay()
      } else if (event.code === 'KeyS' && !event.ctrlKey && !event.metaKey && !event.repeat) {
        event.preventDefault()
        void handleAuditionSeam()
      } else if (event.code === 'KeyM' && !event.ctrlKey && !event.metaKey && !event.repeat) {
        event.preventDefault()
        handleToggleMute()
      } else if (/^Digit[1-8]$/.test(event.code) && !event.ctrlKey && !event.metaKey) {
        const index = Number(event.code.slice(5)) - 1
        const candidate = candidates[index]
        if (candidate) {
          event.preventDefault()
          void handleSelectCandidate(candidate)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    audio,
    candidates,
    confirmAction,
    handleAuditionSeam,
    handleExport,
    handleOpenFile,
    handleSelectCandidate,
    handleToggleMute,
    handleTogglePlay,
    pendingAudio,
  ])

  return (
    <div className={`app-shell ${isDragging ? 'is-dragging' : ''}`}>
      <TitleBar
        audio={audio}
        onOpenFile={() => void handleOpenFile()}
        onClearFile={() => setConfirmAction({ type: 'clear' })}
        disabled={isLoadingFile}
      />

      {!audio ? (
        <main className="workspace workspace--empty">
          <EmptyDropzone
            isDragging={isDragging}
            isLoading={isLoadingFile}
            errorMessage={loadError}
            onOpenFile={() => void handleOpenFile()}
          />
        </main>
      ) : (
        <>
          <main className="workspace">
            <div className="workspace-main">
              <WaveformCanvas
                peaks={audio.peaks}
                duration={duration}
                start={start}
                end={end}
                crossfadeMs={effectiveCrossfadeMs}
                playheadRef={playheadRef}
                isPlaying={isPlaying && playbackMode === 'loop'}
                beatTimes={beatTimes}
                beatsPerBar={beatsPerBar}
                showBeats={showBeats}
                disabled={analyzing}
                onChangeBounds={handleChangeBounds}
                onSeek={(t) => void handleSeek(t)}
                onToggleBeats={() => setShowBeats((prev) => !prev)}
              />

              <SeamInspector
                preview={seamPreview}
                start={start}
                end={end}
                duration={duration}
                crossfadeMs={effectiveCrossfadeMs}
                curve={curve}
                disabled={analyzing}
                onChangeStart={handleChangeStart}
                onChangeEnd={handleChangeEnd}
                onSnapBoundary={(which) => void handleSnapBoundary(which)}
                onChangeCrossfade={handleChangeCrossfade}
                onChangeCurve={handleChangeCurve}
              />
            </div>

            <aside className="workspace-sidebar">
              <CandidateSidebar
                candidates={candidates}
                selectedId={selectedCandidateId}
                analyzing={analyzing}
                progress={progress}
                progressStage={progressStage}
                bpm={bpm}
                beatsPerBar={beatsPerBar}
                hasAudio={Boolean(audio)}
                onAnalyze={() => void handleAnalyze()}
                onCancelAnalysis={() => void handleCancelAnalysis()}
                onSelectCandidate={(candidate) => void handleSelectCandidate(candidate)}
              />
            </aside>
          </main>

          <TransportBar
            isPlaying={isPlaying && playbackMode === 'loop'}
            audioAvailable={audioAvailable}
            playheadRef={playheadRef}
            loopOffsetRef={loopOffsetRef}
            start={start}
            end={end}
            loopDuration={loopDuration}
            volume={volume}
            muted={muted}
            exportFormat={exportFormat}
            exporting={exporting}
            disabled={analyzing}
            statusText={statusText}
            onTogglePlay={() => void handleTogglePlay()}
            onAuditionSeam={() => void handleAuditionSeam()}
            onSeek={(t) => void handleSeek(t)}
            onChangeVolume={handleChangeVolume}
            onToggleMute={handleToggleMute}
            onChangeExportFormat={setExportFormat}
            onExport={() => void handleExport()}
          />
        </>
      )}

      {pendingAudio && (
        <TrimModal
          pending={pendingAudio}
          isPlaying={isPlaying && playbackMode === 'trim'}
          playheadRef={playheadRef}
          onPlayPreview={(s, e, from) => void handleTrimPlayPreview(s, e, from)}
          onPausePreview={() => void handleTrimPausePreview()}
          onCancel={() => void handleCancelTrim()}
          onConfirm={(s, e) => void handleConfirmTrim(s, e)}
        />
      )}

      {confirmAction && (
        <ConfirmDialog
          title={
            confirmAction.type === 'clear'
              ? 'Очистить текущий проект?'
              : 'Открыть новый файл?'
          }
          description={
            confirmAction.type === 'clear'
              ? `Файл «${audio?.fileName ?? ''}» и текущие настройки стыка будут сброшены. Вы сможете открыть или перетащить новый файл.`
              : `Текущий файл «${audio?.fileName ?? pendingAudio?.fileName ?? ''}» будет заменён новым. Несохранённые настройки стыка будут сброшены.`
          }
          detail={
            confirmAction.type === 'replace'
              ? `Новый файл: ${confirmAction.fileName}`
              : undefined
          }
          confirmLabel={confirmAction.type === 'clear' ? 'Очистить' : 'Открыть новый файл'}
          danger={confirmAction.type === 'clear'}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void handleConfirmAction()}
        />
      )}

      {isDragging && audio && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">Отпустите аудио или видео, чтобы заменить текущий файл</div>
        </div>
      )}
    </div>
  )
}

export default App
