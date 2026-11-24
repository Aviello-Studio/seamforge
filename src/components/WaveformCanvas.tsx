import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Crosshair, Grid3x3, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { clamp, formatTime } from '../lib/format'

export interface WaveformCanvasProps {
  peaks: [number, number][]
  duration: number
  start: number
  end: number
  crossfadeMs: number
  playheadRef: React.MutableRefObject<number>
  isPlaying: boolean
  beatTimes: number[]
  beatsPerBar?: number | null
  showBeats: boolean
  disabled?: boolean
  onChangeBounds: (nextStart: number, nextEnd: number) => void
  onSeek: (timeSec: number) => void
  onToggleBeats: () => void
}

const TOP_BAR_H = 22
const RULER_H = 20
const MIN_ZOOM = 1
const MAX_ZOOM = 64
const MIN_LOOP_GAP = 0.1
const HANDLE_HIT_PX = 10

type DragMode = 'start' | 'end' | 'move' | 'seek' | null

interface DragState {
  mode: DragMode
  pointerId: number
  originX: number
  originStart: number
  originEnd: number
}

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

export function WaveformCanvas({
  peaks,
  duration,
  start,
  end,
  crossfadeMs,
  playheadRef,
  isPlaying,
  beatTimes,
  beatsPerBar = 4,
  showBeats,
  disabled = false,
  onChangeBounds,
  onSeek,
  onToggleBeats,
}: WaveformCanvasProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const panbarRef = useRef<HTMLDivElement | null>(null)

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [viewStart, setViewStart] = useState(0)
  const [cursor, setCursor] = useState<string>('crosshair')

  const dragRef = useRef<DragState | null>(null)
  const panDragRef = useRef<{ pointerId: number; originX: number; originViewStart: number } | null>(null)
  const lastDrawnPlayheadRef = useRef<number>(Number.NaN)

  const safeDuration = Math.max(0.001, duration)
  const viewDuration = safeDuration / zoom
  const maxViewStart = Math.max(0, safeDuration - viewDuration)
  const clampedViewStart = clamp(viewStart, 0, maxViewStart)

  // Reset viewport when a new audio waveform is loaded
  useEffect(() => {
    setZoom(1)
    setViewStart(0)
  }, [peaks, duration])

  // Observe container size
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const updateSize = () => {
      const rect = stage.getBoundingClientRect()
      const nextW = Math.max(0, Math.round(rect.width))
      const nextH = Math.max(0, Math.round(rect.height))
      setSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH },
      )
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const timeToX = useCallback(
    (timeSec: number) => {
      if (size.width <= 0) return 0
      return ((timeSec - clampedViewStart) / viewDuration) * size.width
    },
    [clampedViewStart, size.width, viewDuration],
  )

  const xToTime = useCallback(
    (px: number) => {
      if (size.width <= 0) return 0
      return clampedViewStart + (px / size.width) * viewDuration
    },
    [clampedViewStart, size.width, viewDuration],
  )

  const applyZoom = useCallback(
    (nextZoomRaw: number, anchorRatio = 0.5) => {
      const nextZoom = clamp(nextZoomRaw, MIN_ZOOM, MAX_ZOOM)
      const currentViewDur = safeDuration / zoom
      const currentStart = clamp(viewStart, 0, Math.max(0, safeDuration - currentViewDur))
      const anchorTime = currentStart + currentViewDur * clamp(anchorRatio, 0, 1)
      const nextViewDur = safeDuration / nextZoom
      const nextStart = clamp(
        anchorTime - nextViewDur * clamp(anchorRatio, 0, 1),
        0,
        Math.max(0, safeDuration - nextViewDur),
      )
      setZoom(nextZoom)
      setViewStart(nextStart)
    },
    [safeDuration, viewStart, zoom],
  )

  const handleZoomToSeam = useCallback(() => {
    if (duration <= 0) return
    const targetWindow = Math.min(safeDuration, Math.max(3, Math.min(8, (end - start) * 0.45)))
    const nextZoom = clamp(safeDuration / targetWindow, MIN_ZOOM, MAX_ZOOM)
    const nextViewDur = safeDuration / nextZoom
    const nextStart = clamp(end - nextViewDur * 0.65, 0, Math.max(0, safeDuration - nextViewDur))
    setZoom(nextZoom)
    setViewStart(nextStart)
  }, [duration, end, safeDuration, start])

  // Non-passive wheel handler for smooth zoom & pan
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const onWheel = (event: WheelEvent) => {
      if (size.width <= 0 || duration <= 0) return
      event.preventDefault()

      const horizontalPan = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (horizontalPan) {
        if (zoom <= 1) return
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        const panSec = (delta / size.width) * viewDuration * 0.85
        setViewStart((prev) => clamp(prev + panSec, 0, maxViewStart))
        return
      }

      const rect = stage.getBoundingClientRect()
      const cursorRatio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
      const factor = event.deltaY < 0 ? 1.28 : 1 / 1.28
      applyZoom(zoom * factor, cursorRatio)
    }

    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [applyZoom, duration, maxViewStart, size.width, viewDuration, zoom])

  // Draw base waveform layer
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
    const waveTop = TOP_BAR_H
    const waveBottom = Math.max(waveTop + 20, height - RULER_H)
    const waveMidY = (waveTop + waveBottom) / 2
    const waveHalfH = Math.max(8, (waveBottom - waveTop) * 0.45)

    // Recessed well background
    ctx.fillStyle = '#0e1013'
    ctx.fillRect(0, 0, width, height)

    // Top loop-bar lane
    ctx.fillStyle = '#13161b'
    ctx.fillRect(0, 0, width, TOP_BAR_H)
    ctx.strokeStyle = '#232730'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, TOP_BAR_H - 0.5)
    ctx.lineTo(width, TOP_BAR_H - 0.5)
    ctx.stroke()

    // Bottom time ruler lane
    ctx.fillStyle = '#12151a'
    ctx.fillRect(0, waveBottom, width, height - waveBottom)
    ctx.strokeStyle = '#22262f'
    ctx.beginPath()
    ctx.moveTo(0, waveBottom + 0.5)
    ctx.lineTo(width, waveBottom + 0.5)
    ctx.stroke()

    // Horizontal dB reference lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)'
    ctx.beginPath()
    ctx.moveTo(0, waveMidY - waveHalfH * 0.5)
    ctx.lineTo(width, waveMidY - waveHalfH * 0.5)
    ctx.moveTo(0, waveMidY + waveHalfH * 0.5)
    ctx.lineTo(width, waveMidY + waveHalfH * 0.5)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(236, 239, 244, 0.09)'
    ctx.beginPath()
    ctx.moveTo(0, waveMidY)
    ctx.lineTo(width, waveMidY)
    ctx.stroke()

    const viewEnd = clampedViewStart + viewDuration
    const startX = timeToX(start)
    const endX = timeToX(end)
    const barStride = Math.max(1, beatsPerBar ?? 4)

    // Beat grid lines
    if (showBeats && beatTimes.length > 0) {
      for (let i = 0; i < beatTimes.length; i += 1) {
        const bt = beatTimes[i]
        if (bt < clampedViewStart || bt > viewEnd) continue
        const x = Math.round(timeToX(bt)) + 0.5
        ctx.strokeStyle =
          i % barStride === 0 ? 'rgba(236, 239, 244, 0.14)' : 'rgba(236, 239, 244, 0.055)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, waveTop)
        ctx.lineTo(x, waveBottom)
        ctx.stroke()
      }
    }

    // Dim out-of-loop areas
    ctx.fillStyle = 'rgba(7, 8, 10, 0.46)'
    if (startX > 0) {
      ctx.fillRect(0, waveTop, Math.min(width, startX), waveBottom - waveTop)
    }
    if (endX < width) {
      const left = Math.max(0, endX)
      ctx.fillRect(left, waveTop, width - left, waveBottom - waveTop)
    }

    // Crossfade zone shading at loop head (steel blue) and tail (warm amber)
    const fadeSec = crossfadeMs / 1000
    if (fadeSec > 0 && end > start) {
      const headFadeEnd = Math.min(end, start + fadeSec)
      const headX0 = clamp(timeToX(start), 0, width)
      const headX1 = clamp(timeToX(headFadeEnd), 0, width)
      if (headX1 > headX0) {
        ctx.fillStyle = 'rgba(93, 163, 224, 0.16)'
        ctx.fillRect(headX0, waveTop, Math.max(1.5, headX1 - headX0), waveBottom - waveTop)
      }

      const tailFadeStart = Math.max(start, end - fadeSec)
      const tailX0 = clamp(timeToX(tailFadeStart), 0, width)
      const tailX1 = clamp(timeToX(end), 0, width)
      if (tailX1 > tailX0) {
        ctx.fillStyle = 'rgba(229, 154, 60, 0.18)'
        ctx.fillRect(tailX0, waveTop, Math.max(1.5, tailX1 - tailX0), waveBottom - waveTop)
      }
    }

    // Waveform peak bars with subtle vertical luminance gradient inside loop
    const activeWaveGrad = ctx.createLinearGradient(0, waveTop, 0, waveBottom)
    activeWaveGrad.addColorStop(0, '#eef2f7')
    activeWaveGrad.addColorStop(0.5, '#cbd4e1')
    activeWaveGrad.addColorStop(1, '#eef2f7')

    if (peaks.length > 0 && duration > 0) {
      const peakCount = peaks.length
      for (let px = 0; px < width; px += 1) {
        const t0 = clampedViewStart + (px / width) * viewDuration
        const t1 = clampedViewStart + ((px + 1) / width) * viewDuration
        const idx0 = clamp(Math.floor((t0 / safeDuration) * peakCount), 0, peakCount - 1)
        const idx1 = clamp(Math.ceil((t1 / safeDuration) * peakCount), idx0 + 1, peakCount)

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
        const insideLoop = midT >= start && midT <= end
        ctx.fillStyle = insideLoop ? activeWaveGrad : '#424956'

        const yHi = waveMidY - clamp(maxVal, -1, 1) * waveHalfH
        const yLo = waveMidY - clamp(minVal, -1, 1) * waveHalfH
        const barH = Math.max(1, yLo - yHi)
        ctx.fillRect(px, yHi, 1, barH)
      }
    }

    // Time ruler ticks along bottom edge
    if (duration > 0 && width > 60) {
      const niceSteps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
      const targetTickCount = Math.max(3, Math.floor(width / 96))
      const rawStep = viewDuration / targetTickCount
      const stepSec = niceSteps.find((s) => s >= rawStep) ?? 300
      const firstTick = Math.ceil(clampedViewStart / stepSec) * stepSec

      ctx.font = '400 10px "Cascadia Mono", Consolas, monospace'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#6f7786'
      ctx.strokeStyle = '#323845'
      ctx.lineWidth = 1

      for (let t = firstTick; t <= viewEnd + 1e-6; t += stepSec) {
        const x = Math.round(timeToX(t)) + 0.5
        if (x < 6 || x > width - 6) continue
        ctx.beginPath()
        ctx.moveTo(x, waveBottom)
        ctx.lineTo(x, waveBottom + 4)
        ctx.stroke()

        const mins = Math.floor(t / 60)
        const secs = t - mins * 60
        const label =
          stepSec < 1
            ? `${mins}:${secs.toFixed(1).padStart(4, '0')}`
            : `${mins}:${Math.round(secs).toString().padStart(2, '0')}`
        ctx.textAlign = x > width - 38 ? 'right' : x < 34 ? 'left' : 'center'
        ctx.fillText(label, x, waveBottom + RULER_H / 2 + 1)
      }
    }

    // Draggable top loop-region bar
    const barLeft = clamp(startX, 0, width)
    const barRight = clamp(endX, 0, width)
    if (barRight > barLeft) {
      ctx.fillStyle = 'rgba(229, 154, 60, 0.18)'
      ctx.fillRect(barLeft, 1, barRight - barLeft, TOP_BAR_H - 2)
      ctx.fillStyle = 'rgba(229, 154, 60, 0.65)'
      ctx.fillRect(barLeft, TOP_BAR_H - 2, barRight - barLeft, 1.5)

      if (barRight - barLeft >= 74) {
        const spanText = formatTime(Math.max(0, end - start))
        ctx.font = '600 10px "Cascadia Mono", Consolas, monospace'
        ctx.fillStyle = '#f2c17d'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(spanText, (barLeft + barRight) / 2, TOP_BAR_H / 2)
      }
    }

    // Boundary lines and top grip pills
    const drawBoundaryLine = (x: number) => {
      if (x < -12 || x > width + 12) return
      const crispX = Math.round(x) + 0.5
      ctx.strokeStyle = '#e59a3c'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(crispX, 0)
      ctx.lineTo(crispX, waveBottom)
      ctx.stroke()

      const pillW = 9
      const pillH = 16
      const pillX = clamp(x - pillW / 2, 0.5, width - pillW - 0.5)
      drawRoundedRect(ctx, pillX, 3, pillW, pillH, 3)
      ctx.fillStyle = '#e59a3c'
      ctx.fill()

      ctx.strokeStyle = '#121417'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(pillX + pillW / 2, 6.5)
      ctx.lineTo(pillX + pillW / 2, 15.5)
      ctx.stroke()
    }

    drawBoundaryLine(startX)
    drawBoundaryLine(endX)

    // Clamped timecode badges (collision-avoided inside canvas bounds)
    ctx.font = '500 10px "Cascadia Mono", Consolas, monospace'
    const startLabel = formatTime(start)
    const endLabel = formatTime(end)
    const badgePadX = 6
    const badgeH = 17
    const badgeY = TOP_BAR_H + 6

    const startBadgeW = Math.ceil(ctx.measureText(startLabel).width) + badgePadX * 2
    const endBadgeW = Math.ceil(ctx.measureText(endLabel).width) + badgePadX * 2

    const showStartBadge = startX >= -20 && startX <= width + 20
    const showEndBadge = endX >= -20 && endX <= width + 20

    let startBadgeX = clamp(startX + 7, 4, Math.max(4, width - startBadgeW - 4))
    let endBadgeX = clamp(endX - endBadgeW - 7, 4, Math.max(4, width - endBadgeW - 4))

    if (showStartBadge && showEndBadge && startBadgeX + startBadgeW + 4 > endBadgeX) {
      const overlap = startBadgeX + startBadgeW + 4 - endBadgeX
      startBadgeX = clamp(startBadgeX - overlap / 2, 4, Math.max(4, width - startBadgeW - 4))
      endBadgeX = clamp(
        startBadgeX + startBadgeW + 4,
        4,
        Math.max(4, width - endBadgeW - 4),
      )
      if (startBadgeX + startBadgeW + 4 > endBadgeX) {
        startBadgeX = clamp(endBadgeX - startBadgeW - 4, 4, Math.max(4, width - startBadgeW - 4))
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
      ctx.fillText(text, x + badgePadX, badgeY + badgeH / 2 + 0.5)
    }

    if (showStartBadge) drawBadge(startBadgeX, startBadgeW, startLabel)
    if (showEndBadge) drawBadge(endBadgeX, endBadgeW, endLabel)
  }, [
    beatTimes,
    beatsPerBar,
    clampedViewStart,
    crossfadeMs,
    duration,
    end,
    peaks,
    safeDuration,
    showBeats,
    size,
    start,
    timeToX,
    viewDuration,
  ])

  // Draw overlay playhead layer (reads playheadRef.current directly via RAF)
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

    const current = playheadRef.current
    lastDrawnPlayheadRef.current = current

    const viewEnd = clampedViewStart + viewDuration
    if (!Number.isFinite(current) || current < clampedViewStart || current > viewEnd) {
      return
    }

    const x = timeToX(current)
    const crispX = Math.round(x) + 0.5

    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
    ctx.shadowBlur = 4
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(crispX, 0)
    ctx.lineTo(crispX, Math.max(TOP_BAR_H, size.height - RULER_H))
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(x - 5, 0)
    ctx.lineTo(x + 5, 0)
    ctx.lineTo(x, 6)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }, [clampedViewStart, playheadRef, size.height, size.width, timeToX, viewDuration])

  useEffect(() => {
    drawOverlay()
    if (isPlaying) {
      let frameId = 0
      const tick = () => {
        drawOverlay()
        frameId = window.requestAnimationFrame(tick)
      }
      frameId = window.requestAnimationFrame(tick)
      return () => window.cancelAnimationFrame(frameId)
    }

    // While paused, redraw only if an external control (e.g. TransportBar scrubber) moved playheadRef
    const intervalId = window.setInterval(() => {
      if (Math.abs(playheadRef.current - lastDrawnPlayheadRef.current) > 0.0005) {
        drawOverlay()
      }
    }, 60)
    return () => window.clearInterval(intervalId)
  }, [drawOverlay, isPlaying, playheadRef])

  const hitTestMode = (x: number, y: number): DragMode => {
    const startX = timeToX(start)
    const endX = timeToX(end)

    if (!disabled) {
      const distStart = Math.abs(x - startX)
      const distEnd = Math.abs(x - endX)
      const hitsStart = distStart <= HANDLE_HIT_PX
      const hitsEnd = distEnd <= HANDLE_HIT_PX

      if (hitsStart && hitsEnd) {
        return distStart <= distEnd ? 'start' : 'end'
      }
      if (hitsStart) return 'start'
      if (hitsEnd) return 'end'

      if (y <= TOP_BAR_H && x >= startX && x <= endX) {
        return 'move'
      }
    }

    return 'seek'
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || size.width <= 0 || duration <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const mode = hitTestMode(x, y)
    if (!mode) return

    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      originX: x,
      originStart: start,
      originEnd: end,
    }

    if (mode === 'move') {
      setCursor('grabbing')
    } else if (mode === 'start' || mode === 'end') {
      setCursor('ew-resize')
    } else if (mode === 'seek') {
      const targetTime = clamp(xToTime(x), 0, duration)
      onSeek(targetTime)
      drawOverlay()
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (size.width <= 0 || duration <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    const drag = dragRef.current
    if (!drag) {
      const hoverMode = hitTestMode(x, y)
      if (hoverMode === 'start' || hoverMode === 'end') setCursor('ew-resize')
      else if (hoverMode === 'move') setCursor('grab')
      else setCursor('crosshair')
      return
    }

    if (drag.mode === 'start') {
      const nextStart = clamp(xToTime(x), 0, Math.max(0, drag.originEnd - MIN_LOOP_GAP))
      onChangeBounds(nextStart, drag.originEnd)
    } else if (drag.mode === 'end') {
      const nextEnd = clamp(xToTime(x), drag.originStart + MIN_LOOP_GAP, duration)
      onChangeBounds(drag.originStart, nextEnd)
    } else if (drag.mode === 'move') {
      const deltaSec = ((x - drag.originX) / size.width) * viewDuration
      const span = drag.originEnd - drag.originStart
      const nextStart = clamp(drag.originStart + deltaSec, 0, Math.max(0, duration - span))
      onChangeBounds(nextStart, nextStart + span)
    } else if (drag.mode === 'seek') {
      const targetTime = clamp(xToTime(x), 0, duration)
      onSeek(targetTime)
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
    setCursor('crosshair')
  }

  const handlePanbarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || zoom <= 1) return
    const bar = panbarRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    if (rect.width <= 0) return

    event.currentTarget.setPointerCapture(event.pointerId)
    const clickRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    const thumbLeftRatio = clampedViewStart / safeDuration
    const thumbWidthRatio = viewDuration / safeDuration

    let startView = clampedViewStart
    if (clickRatio < thumbLeftRatio || clickRatio > thumbLeftRatio + thumbWidthRatio) {
      startView = clamp(clickRatio * safeDuration - viewDuration / 2, 0, maxViewStart)
      setViewStart(startView)
    }

    panDragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originViewStart: startView,
    }
  }

  const handlePanbarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current
    const bar = panbarRef.current
    if (!drag || !bar) return
    const rect = bar.getBoundingClientRect()
    if (rect.width <= 0) return

    const deltaRatio = (event.clientX - drag.originX) / rect.width
    setViewStart(clamp(drag.originViewStart + deltaRatio * safeDuration, 0, maxViewStart))
  }

  const endPanDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    panDragRef.current = null
  }

  const thumbLeftPct = (clampedViewStart / safeDuration) * 100
  const thumbWidthPct = clamp((viewDuration / safeDuration) * 100, 4, 100)
  const loopLeftPct = (start / safeDuration) * 100
  const loopWidthPct = clamp(((end - start) / safeDuration) * 100, 0.5, 100)

  return (
    <section className="panel waveform-panel" aria-label="Волновая форма и границы петли">
      <div className="panel-header waveform-toolbar">
        <div className="waveform-toolbar-group">
          <h2 className="panel-title">Волновая форма</h2>
          <span className="waveform-span-readout">
            {formatTime(start)} → {formatTime(end)}
          </span>
        </div>

        <div className="waveform-toolbar-controls">
          <div className="waveform-zoom-group" role="group" aria-label="Масштаб волновой формы">
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={() => applyZoom(zoom / 1.5)}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Уменьшить масштаб"
              title="Уменьшить масштаб"
            >
              <ZoomOut size={14} strokeWidth={1.85} aria-hidden="true" />
            </button>
            <span className="waveform-zoom-badge" aria-label="Текущий масштаб">
              {zoom.toFixed(1)}×
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={() => applyZoom(zoom * 1.5)}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Увеличить масштаб"
              title="Увеличить масштаб"
            >
              <ZoomIn size={14} strokeWidth={1.85} aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setZoom(1)
              setViewStart(0)
            }}
            disabled={zoom <= MIN_ZOOM}
            title="Показать весь трек"
          >
            <Maximize2 size={13} strokeWidth={1.85} aria-hidden="true" />
            <span>Весь трек</span>
          </button>

          <button
            type="button"
            className="btn btn--ghost"
            onClick={handleZoomToSeam}
            disabled={duration <= 0}
            title="Приблизить область стыка"
          >
            <Crosshair size={13} strokeWidth={1.85} aria-hidden="true" />
            <span>К стыку</span>
          </button>

          <button
            type="button"
            className={`btn btn--ghost ${showBeats && beatTimes.length > 0 ? 'is-active' : ''}`}
            onClick={onToggleBeats}
            disabled={beatTimes.length === 0}
            aria-pressed={showBeats && beatTimes.length > 0}
            title={
              beatTimes.length === 0
                ? 'Сетка долей появится после анализа'
                : 'Показать или скрыть сетку долей'
            }
          >
            <Grid3x3 size={13} strokeWidth={1.85} aria-hidden="true" />
            <span>Доли</span>
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="waveform-stage"
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <canvas ref={baseCanvasRef} className="waveform-canvas" />
        <canvas ref={overlayCanvasRef} className="waveform-overlay" aria-hidden="true" />
      </div>

      {zoom > 1 && (
        <div
          ref={panbarRef}
          className="waveform-panbar"
          role="scrollbar"
          aria-label="Навигация по волновой форме"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(thumbLeftPct)}
          onPointerDown={handlePanbarPointerDown}
          onPointerMove={handlePanbarPointerMove}
          onPointerUp={endPanDrag}
          onPointerCancel={endPanDrag}
        >
          <div
            className="waveform-panbar-loop"
            style={{ left: `${loopLeftPct}%`, width: `${loopWidthPct}%` }}
          />
          <div
            className="waveform-panbar-thumb"
            style={{ left: `${thumbLeftPct}%`, width: `${thumbWidthPct}%` }}
          />
        </div>
      )}
    </section>
  )
}
