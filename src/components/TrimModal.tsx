import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, Scissors, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import type { AudioSummary } from '../api/types'
import { clamp, formatTime, formatTimeDetailed } from '../lib/format'
import { formatChannelLabel, formatSampleRateLocalized, useI18n } from '../lib/i18n'

export interface TrimModalProps {
  pending: AudioSummary
  isPlaying: boolean
  playheadRef: React.MutableRefObject<number>
  volume: number
  muted: boolean
  onChangeVolume: (volume: number) => void
  onToggleMute: () => void
  onPlayPreview: (startSec: number, endSec: number, fromSec?: number) => void
  onPausePreview: () => void
  onCancel: () => void
  onConfirm: (startSec: number, endSec: number) => void
}

const HANDLE_HIT_PX = 12

type TrimDragMode = 'start' | 'end' | 'seek' | null

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

export function TrimModal({
  pending,
  isPlaying,
  playheadRef,
  volume,
  muted,
  onChangeVolume,
  onToggleMute,
  onPlayPreview,
  onPausePreview,
  onCancel,
  onConfirm,
}: TrimModalProps) {
  const { locale, t } = useI18n()
  const totalDuration = Math.max(0.001, pending.duration)
  const minGap = Math.min(0.2, totalDuration * 0.5)

  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(pending.duration)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [cursor, setCursor] = useState<string>('crosshair')

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{ mode: TrimDragMode; pointerId: number } | null>(null)

  useEffect(() => {
    setTrimStart(0)
    setTrimEnd(pending.duration)
  }, [pending])

  // Observe canvas wrapper size
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const updateSize = () => {
      const rect = wrap.getBoundingClientRect()
      const nextW = Math.max(0, Math.round(rect.width))
      const nextH = Math.max(0, Math.round(rect.height))
      setSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH },
      )
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  // Keyboard shortcuts for modal: Escape, Space, Enter
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null

      if (event.code === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }

      if (event.code === 'Space' && !event.repeat) {
        if (target?.matches('input, button, select, textarea')) return
        event.preventDefault()
        if (isPlaying) {
          onPausePreview()
        } else {
          const cur = playheadRef.current
          const resumeFrom = cur >= trimStart && cur < trimEnd - 0.05 ? cur : trimStart
          onPlayPreview(trimStart, trimEnd, resumeFrom)
        }
        return
      }

      if (event.code === 'KeyM' && !event.ctrlKey && !event.metaKey && !event.repeat) {
        if (target?.matches('input, button, select, textarea')) return
        event.preventDefault()
        onToggleMute()
        return
      }

      if (event.code === 'Enter' && !event.repeat) {
        if (target?.matches('button, input[type="button"], input[type="submit"], select, textarea')) {
          return
        }
        event.preventDefault()
        onConfirm(trimStart, trimEnd)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isPlaying, onCancel, onConfirm, onPausePreview, onPlayPreview, onToggleMute, playheadRef, trimEnd, trimStart])

  const timeToX = useCallback(
    (timeSec: number) => {
      if (size.width <= 0) return 0
      return (clamp(timeSec, 0, totalDuration) / totalDuration) * size.width
    },
    [size.width, totalDuration],
  )

  const xToTime = useCallback(
    (px: number) => {
      if (size.width <= 0) return 0
      return clamp((px / size.width) * totalDuration, 0, totalDuration)
    },
    [size.width, totalDuration],
  )

  // Draw base waveform trimmer
  useEffect(() => {
    const canvas = baseCanvasRef.current
    if (!canvas || size.width <= 0 || size.height <= 0) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const { width, height } = size
    const midY = height / 2
    const halfH = Math.max(10, height * 0.4)

    ctx.fillStyle = '#0e1013'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(236, 239, 244, 0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(width, midY)
    ctx.stroke()

    const startX = timeToX(trimStart)
    const endX = timeToX(trimEnd)

    // Dim trimmed-out areas
    ctx.fillStyle = 'rgba(7, 8, 10, 0.5)'
    if (startX > 0) ctx.fillRect(0, 0, startX, height)
    if (endX < width) ctx.fillRect(endX, 0, width - endX, height)

    // Active range subtle tint
    if (endX > startX) {
      ctx.fillStyle = 'rgba(229, 154, 60, 0.06)'
      ctx.fillRect(startX, 0, endX - startX, height)
    }

    // Peaks
    const { peaks } = pending
    if (peaks.length > 0) {
      const peakCount = peaks.length
      for (let px = 0; px < width; px += 1) {
        const t0 = (px / width) * totalDuration
        const t1 = ((px + 1) / width) * totalDuration
        const idx0 = clamp(Math.floor((t0 / totalDuration) * peakCount), 0, peakCount - 1)
        const idx1 = clamp(Math.ceil((t1 / totalDuration) * peakCount), idx0 + 1, peakCount)

        let minVal = 1
        let maxVal = -1
        for (let i = idx0; i < idx1; i += 1) {
          const [lo, hi] = peaks[i]
          if (lo < minVal) minVal = lo
          if (hi > maxVal) maxVal = hi
        }
        if (minVal > maxVal) {
          minVal = 0
          maxVal = 0
        }

        const midT = (t0 + t1) * 0.5
        ctx.fillStyle = midT >= trimStart && midT <= trimEnd ? '#cfd6e2' : '#464d59'

        const yHi = midY - clamp(maxVal, -1, 1) * halfH
        const yLo = midY - clamp(minVal, -1, 1) * halfH
        ctx.fillRect(px, yHi, 1, Math.max(1, yLo - yHi))
      }
    }

    // Handles
    const drawHandle = (x: number) => {
      const crispX = Math.round(x) + 0.5
      ctx.strokeStyle = '#e59a3c'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(crispX, 0)
      ctx.lineTo(crispX, height)
      ctx.stroke()

      const gripW = 9
      const gripH = 26
      const gripX = clamp(x - gripW / 2, 0.5, width - gripW - 0.5)
      const gripY = (height - gripH) / 2
      drawRoundedRect(ctx, gripX, gripY, gripW, gripH, 4)
      ctx.fillStyle = '#e59a3c'
      ctx.fill()

      ctx.strokeStyle = '#121417'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(gripX + gripW / 2, gripY + 6)
      ctx.lineTo(gripX + gripW / 2, gripY + gripH - 6)
      ctx.stroke()
    }

    drawHandle(startX)
    drawHandle(endX)

    // Clamped timecode badges
    ctx.font = '500 10px "Cascadia Mono", Consolas, monospace'
    const startLabel = formatTime(trimStart)
    const endLabel = formatTime(trimEnd)
    const padX = 6
    const badgeH = 17
    const badgeY = 6
    const startW = Math.ceil(ctx.measureText(startLabel).width) + padX * 2
    const endW = Math.ceil(ctx.measureText(endLabel).width) + padX * 2

    let startBadgeX = clamp(startX + 8, 4, Math.max(4, width - startW - 4))
    let endBadgeX = clamp(endX - endW - 8, 4, Math.max(4, width - endW - 4))

    if (startBadgeX + startW + 4 > endBadgeX) {
      const overlap = startBadgeX + startW + 4 - endBadgeX
      startBadgeX = clamp(startBadgeX - overlap / 2, 4, Math.max(4, width - startW - 4))
      endBadgeX = clamp(startBadgeX + startW + 4, 4, Math.max(4, width - endW - 4))
      if (startBadgeX + startW + 4 > endBadgeX) {
        startBadgeX = clamp(endBadgeX - startW - 4, 4, Math.max(4, width - startW - 4))
      }
    }

    const drawBadge = (x: number, w: number, text: string) => {
      drawRoundedRect(ctx, x, badgeY, w, badgeH, 4)
      ctx.fillStyle = 'rgba(18, 20, 23, 0.9)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(229, 154, 60, 0.5)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#eceff4'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, x + padX, badgeY + badgeH / 2 + 0.5)
    }

    drawBadge(startBadgeX, startW, startLabel)
    drawBadge(endBadgeX, endW, endLabel)
  }, [pending, size, timeToX, totalDuration, trimEnd, trimStart])

  // Draw live playhead overlay
  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas || size.width <= 0 || size.height <= 0) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const targetW = Math.round(size.width * dpr)
    const targetH = Math.round(size.height * dpr)
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)

    const pos = playheadRef.current
    if (!Number.isFinite(pos) || pos < 0 || pos > totalDuration) return

    const x = timeToX(pos)
    const crispX = Math.round(x) + 0.5
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(crispX, 0)
    ctx.lineTo(crispX, size.height)
    ctx.stroke()
  }, [playheadRef, size.height, size.width, timeToX, totalDuration])

  useEffect(() => {
    drawOverlay()
    if (!isPlaying) return

    let frameId = 0
    const tick = () => {
      drawOverlay()
      frameId = window.requestAnimationFrame(tick)
    }
    frameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameId)
  }, [drawOverlay, isPlaying])

  const hitTestHandle = (x: number): TrimDragMode => {
    const startX = timeToX(trimStart)
    const endX = timeToX(trimEnd)
    const distStart = Math.abs(x - startX)
    const distEnd = Math.abs(x - endX)

    if (distStart <= HANDLE_HIT_PX && distEnd <= HANDLE_HIT_PX) {
      return distStart <= distEnd ? 'start' : 'end'
    }
    if (distStart <= HANDLE_HIT_PX) return 'start'
    if (distEnd <= HANDLE_HIT_PX) return 'end'
    return 'seek'
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || size.width <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const mode = hitTestHandle(x)

    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { mode, pointerId: event.pointerId }

    if (mode === 'seek') {
      const target = clamp(xToTime(x), trimStart, trimEnd)
      playheadRef.current = target
      drawOverlay()
      if (isPlaying) {
        onPlayPreview(trimStart, trimEnd, target)
      }
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (size.width <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const drag = dragRef.current

    if (!drag) {
      const hover = hitTestHandle(x)
      setCursor(hover === 'start' || hover === 'end' ? 'ew-resize' : 'crosshair')
      return
    }

    if (drag.mode === 'start') {
      if (isPlaying) onPausePreview()
      const nextStart = clamp(xToTime(x), 0, Math.max(0, trimEnd - minGap))
      setTrimStart(nextStart)
      playheadRef.current = nextStart
      drawOverlay()
    } else if (drag.mode === 'end') {
      if (isPlaying) onPausePreview()
      const nextEnd = clamp(xToTime(x), trimStart + minGap, pending.duration)
      setTrimEnd(nextEnd)
      if (playheadRef.current > nextEnd) {
        playheadRef.current = trimStart
        drawOverlay()
      }
    } else if (drag.mode === 'seek') {
      const target = clamp(xToTime(x), trimStart, trimEnd)
      playheadRef.current = target
      drawOverlay()
    }
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }

  const selectionDuration = Math.max(0, trimEnd - trimStart)
  const channelLabel = formatChannelLabel(pending.channels, locale)

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="trim-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trim-modal-title"
      >
        <header className="trim-header">
          <div className="trim-header-info">
            <span className="trim-header-icon" aria-hidden="true">
              <Scissors size={16} strokeWidth={1.85} />
            </span>
            <div className="trim-header-text">
              <h2 id="trim-modal-title">{t.trimTitle}</h2>
              <p title={pending.fileName}>
                {pending.fileName} · {formatSampleRateLocalized(pending.sampleRate, locale)} · {channelLabel} ·{' '}
                {formatTime(pending.duration)}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onCancel}
            aria-label={t.trimCloseAria}
            title={t.trimCloseTitle}
          >
            <X size={15} strokeWidth={1.85} aria-hidden="true" />
          </button>
        </header>

        <div className="trim-body">
          <div
            ref={wrapRef}
            className="trim-canvas-wrap"
            style={{ cursor }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <canvas ref={baseCanvasRef} className="trim-canvas" />
            <canvas ref={overlayCanvasRef} className="trim-overlay" aria-hidden="true" />
          </div>

          <div className="trim-sliders">
            <label className="trim-slider-field">
              <span className="trim-slider-head">
                <span>{t.trimStartLabel}</span>
                <output>{formatTimeDetailed(trimStart)}</output>
              </span>
              <input
                className="studio-range"
                type="range"
                min={0}
                max={Math.max(0, pending.duration - minGap)}
                step={0.01}
                value={trimStart}
                onChange={(event) => {
                  if (isPlaying) onPausePreview()
                  const nextStart = clamp(Number(event.target.value), 0, Math.max(0, trimEnd - minGap))
                  setTrimStart(nextStart)
                  playheadRef.current = nextStart
                  drawOverlay()
                }}
              />
            </label>

            <label className="trim-slider-field">
              <span className="trim-slider-head">
                <span>{t.trimEndLabel}</span>
                <output>{formatTimeDetailed(trimEnd)}</output>
              </span>
              <input
                className="studio-range"
                type="range"
                min={minGap}
                max={pending.duration}
                step={0.01}
                value={trimEnd}
                onChange={(event) => {
                  if (isPlaying) onPausePreview()
                  const nextEnd = clamp(Number(event.target.value), trimStart + minGap, pending.duration)
                  setTrimEnd(nextEnd)
                  if (playheadRef.current > nextEnd) {
                    playheadRef.current = trimStart
                    drawOverlay()
                  }
                }}
              />
            </label>
          </div>
        </div>

        <footer className="trim-footer">
          <div className="trim-duration">
            <span className="trim-duration-label">{t.trimDurationLabel}</span>
            <strong className="trim-duration-value">
              {formatTime(selectionDuration)}{' '}
              <span className="trim-duration-total">/ {formatTime(pending.duration)}</span>
            </strong>
          </div>

          <div className="trim-footer-actions">
            <div className="trim-volume" aria-label={t.trimVolumeAria}>
              <button
                type="button"
                className={`btn btn--ghost btn--icon transport-volume-btn ${muted || volume === 0 ? 'is-muted' : ''}`}
                onClick={onToggleMute}
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
                className="studio-range trim-volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                aria-label={t.trimVolumeAria}
                onChange={(event) => onChangeVolume(Number(event.target.value))}
              />
              <span className="transport-volume-value">
                {Math.round((muted ? 0 : volume) * 100)}%
              </span>
            </div>

            <button
              type="button"
              className={`btn btn--secondary ${isPlaying ? 'is-playing' : ''}`}
              onClick={() => {
                if (isPlaying) {
                  onPausePreview()
                } else {
                  const cur = playheadRef.current
                  const resumeFrom = cur >= trimStart && cur < trimEnd - 0.05 ? cur : trimStart
                  onPlayPreview(trimStart, trimEnd, resumeFrom)
                }
              }}
            >
              {isPlaying ? (
                <Pause size={14} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Play size={14} strokeWidth={2} aria-hidden="true" />
              )}
              <span>{isPlaying ? t.trimStop : t.trimPlay}</span>
              <kbd className="kbd">Space</kbd>
            </button>

            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => onConfirm(0, pending.duration)}
            >
              {t.trimUseFull}
            </button>

            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onConfirm(trimStart, trimEnd)}
            >
              {t.trimApply}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
