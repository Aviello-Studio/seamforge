import type React from 'react'
import { useEffect, useRef } from 'react'
import { Download, Loader2, Pause, Play, Repeat, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { WavFormat } from '../api/types'
import { clamp, formatTime } from '../lib/format'
import { useI18n } from '../lib/i18n'

export interface TransportBarProps {
  isPlaying: boolean
  audioAvailable: boolean
  playheadRef: React.MutableRefObject<number>
  loopOffsetRef: React.MutableRefObject<number>
  start: number
  end: number
  loopDuration: number
  volume: number
  muted: boolean
  exportFormat: WavFormat
  exporting: boolean
  disabled: boolean
  statusText: string
  onTogglePlay: () => void
  onAuditionSeam: () => void
  onSeek: (timeSec: number) => void
  onChangeVolume: (volume: number) => void
  onToggleMute: () => void
  onChangeExportFormat: (format: WavFormat) => void
  onExport: () => void
}

export function TransportBar({
  isPlaying,
  audioAvailable,
  playheadRef,
  loopOffsetRef,
  start,
  end,
  loopDuration,
  volume,
  muted,
  exportFormat,
  exporting,
  disabled,
  statusText,
  onTogglePlay,
  onAuditionSeam,
  onSeek,
  onChangeVolume,
  onToggleMute,
  onChangeExportFormat,
  onExport,
}: TransportBarProps) {
  const { t } = useI18n()
  const currentTimeElRef = useRef<HTMLSpanElement | null>(null)
  const scrubberInputRef = useRef<HTMLInputElement | null>(null)
  const isScrubbingRef = useRef(false)
  const lastSyncedPosRef = useRef<number>(Number.NaN)
  const lastSyncedOffsetRef = useRef<number>(Number.NaN)

  useEffect(() => {
    const syncDomFromPlayhead = () => {
      const safeEnd = Math.max(start + 0.01, end)
      const pos = clamp(playheadRef.current, start, safeEnd)
      const offset = clamp(loopOffsetRef.current, 0, Math.max(0, loopDuration))
      lastSyncedPosRef.current = pos
      lastSyncedOffsetRef.current = offset

      if (currentTimeElRef.current) {
        currentTimeElRef.current.textContent = formatTime(offset)
      }
      if (scrubberInputRef.current && !isScrubbingRef.current) {
        scrubberInputRef.current.value = pos.toFixed(3)
      }
    }

    syncDomFromPlayhead()
    if (isPlaying) {
      let frameId = 0
      const tick = () => {
        syncDomFromPlayhead()
        frameId = window.requestAnimationFrame(tick)
      }
      frameId = window.requestAnimationFrame(tick)
      return () => window.cancelAnimationFrame(frameId)
    }

    const intervalId = window.setInterval(() => {
      const safeEnd = Math.max(start + 0.01, end)
      const pos = clamp(playheadRef.current, start, safeEnd)
      const offset = clamp(loopOffsetRef.current, 0, Math.max(0, loopDuration))
      if (
        Math.abs(pos - lastSyncedPosRef.current) > 0.0005 ||
        Math.abs(offset - lastSyncedOffsetRef.current) > 0.0005
      ) {
        syncDomFromPlayhead()
      }
    }, 60)
    return () => window.clearInterval(intervalId)
  }, [end, isPlaying, loopDuration, loopOffsetRef, playheadRef, start])

  const safeMax = Math.max(start + 0.01, end)
  const initialPos = clamp(playheadRef.current, start, safeMax)
  const initialRel = clamp(loopOffsetRef.current, 0, Math.max(0, loopDuration))

  return (
    <footer className="transport-bar" aria-label={t.transportRegionAria}>
      <div className="transport-controls">
        <button
          type="button"
          className={`btn btn--secondary transport-play-btn ${isPlaying ? 'is-playing' : ''}`}
          onClick={onTogglePlay}
          disabled={disabled || !audioAvailable}
          title={!audioAvailable ? t.transportAudioUnavailable : t.transportPlayTitle}
        >
          {isPlaying ? (
            <Pause size={14} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Play size={14} strokeWidth={2} aria-hidden="true" />
          )}
          <span>{isPlaying ? t.transportPause : t.transportPlay}</span>
          <kbd className="kbd">Space</kbd>
        </button>

        <button
          type="button"
          className="btn btn--ghost transport-seam-btn"
          onClick={onAuditionSeam}
          disabled={disabled || !audioAvailable}
          title={t.transportSeamTitle}
        >
          <Repeat size={14} strokeWidth={1.85} aria-hidden="true" />
          <span>{t.transportSeam}</span>
          <kbd className="kbd">S</kbd>
        </button>

        <div className="transport-time" aria-label={t.transportLoopPositionAria}>
          <span ref={currentTimeElRef} className="transport-time-current">
            {formatTime(initialRel)}
          </span>
          <span className="transport-time-sep" aria-hidden="true">
            /
          </span>
          <span className="transport-time-total">{formatTime(loopDuration)}</span>
        </div>
      </div>

      <div className="transport-scrubber">
        <input
          ref={scrubberInputRef}
          className="studio-range transport-range"
          type="range"
          min={start}
          max={safeMax}
          step={0.01}
          defaultValue={initialPos.toFixed(3)}
          disabled={disabled}
          aria-label={t.transportPlaybackPositionAria}
          onPointerDown={() => {
            isScrubbingRef.current = true
          }}
          onPointerUp={() => {
            isScrubbingRef.current = false
          }}
          onPointerCancel={() => {
            isScrubbingRef.current = false
          }}
          onBlur={() => {
            isScrubbingRef.current = false
          }}
          onChange={(event) => {
            const nextPos = Number(event.target.value)
            if (currentTimeElRef.current) {
              const rel = clamp(nextPos - start, 0, Math.max(0, loopDuration))
              currentTimeElRef.current.textContent = formatTime(rel)
            }
            onSeek(nextPos)
          }}
        />
        {!audioAvailable ? (
          <div className="transport-status is-warning" title={t.transportAudioUnavailable}>
            {t.transportAudioUnavailable}
          </div>
        ) : statusText ? (
          <div className="transport-status" title={statusText}>
            {statusText}
          </div>
        ) : null}
      </div>

      <div className="transport-volume" aria-label={t.transportVolumeRegionAria}>
        <button
          type="button"
          className={`btn btn--ghost btn--icon transport-volume-btn ${muted || volume === 0 ? 'is-muted' : ''}`}
          onClick={onToggleMute}
          disabled={!audioAvailable}
          aria-label={muted || volume === 0 ? t.transportUnmuteAria : t.transportMuteAria}
          title={muted || volume === 0 ? t.transportUnmuteTitle : t.transportMuteTitle}
        >
          {muted || volume <= 0.001 ? (
            <VolumeX size={15} strokeWidth={1.85} aria-hidden="true" />
          ) : volume < 0.5 ? (
            <Volume1 size={15} strokeWidth={1.85} aria-hidden="true" />
          ) : (
            <Volume2 size={15} strokeWidth={1.85} aria-hidden="true" />
          )}
        </button>
        <input
          className="studio-range transport-volume-slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          disabled={!audioAvailable}
          aria-label={t.transportVolumeSliderAria}
          title={t.transportVolumeSliderTitle}
          onChange={(event) => onChangeVolume(Number(event.target.value))}
        />
        <span className="transport-volume-value">{Math.round((muted ? 0 : volume) * 100)}%</span>
      </div>

      <div className="transport-export">
        <select
          className="transport-select"
          aria-label={t.transportWavFormatAria}
          value={exportFormat}
          disabled={disabled || exporting}
          onChange={(event) => onChangeExportFormat(event.target.value as WavFormat)}
        >
          <option value="pcm16">{t.transportWav16}</option>
          <option value="pcm24">{t.transportWav24}</option>
          <option value="float32">{t.transportWav32}</option>
        </select>

        <button
          type="button"
          className="btn btn--primary transport-export-btn"
          onClick={onExport}
          disabled={disabled || exporting}
          title={t.transportExportTitle}
        >
          {exporting ? (
            <Loader2 size={14} strokeWidth={2} className="is-spinning" aria-hidden="true" />
          ) : (
            <Download size={14} strokeWidth={2} aria-hidden="true" />
          )}
          <span>{exporting ? t.transportExporting : t.transportExport}</span>
        </button>
      </div>
    </footer>
  )
}
