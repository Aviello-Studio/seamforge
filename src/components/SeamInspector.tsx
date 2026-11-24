import { useEffect, useRef, useState } from 'react'
import { Magnet } from 'lucide-react'
import type { CrossfadeCurve, SeamPreviewData } from '../api/types'
import { clamp, formatTimeDetailed } from '../lib/format'

export interface SeamInspectorProps {
  preview: SeamPreviewData | null
  start: number
  end: number
  duration: number
  crossfadeMs: number
  curve: CrossfadeCurve
  disabled?: boolean
  onChangeStart: (nextStart: number) => void
  onChangeEnd: (nextEnd: number) => void
  onSnapBoundary: (which: 'start' | 'end') => void
  onChangeCrossfade: (ms: number) => void
  onChangeCurve: (curve: CrossfadeCurve) => void
}

const NUDGE_STEPS_MS = [-10, -1, 1, 10] as const

function formatPhasePercent(correlation: number): { label: string; tone: 'is-good' | 'is-mid' | 'is-bad' } {
  if (!Number.isFinite(correlation)) {
    return { label: '—', tone: 'is-mid' }
  }
  const scaled = Math.abs(correlation) <= 1.001 ? correlation * 100 : correlation
  const pct = Math.round(clamp(scaled, -100, 100))
  const tone = pct >= 70 ? 'is-good' : pct >= 35 ? 'is-mid' : 'is-bad'
  return { label: `${pct}%`, tone }
}

function formatContinuityPercent(continuity: number): { label: string; tone: 'is-good' | 'is-mid' | 'is-bad' } {
  if (!Number.isFinite(continuity)) {
    return { label: '—', tone: 'is-mid' }
  }
  const scaled = continuity <= 1.001 ? continuity * 100 : continuity
  const pct = Math.round(clamp(scaled, 0, 100))
  const tone = pct >= 80 ? 'is-good' : pct >= 55 ? 'is-mid' : 'is-bad'
  return { label: `${pct}%`, tone }
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  samples: number[],
  padX: number,
  plotW: number,
  midY: number,
  halfH: number,
  amplitudeScale: number,
  strokeStyle: string,
  lineWidth: number,
) {
  if (samples.length < 2) return
  ctx.beginPath()
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const lastIdx = samples.length - 1
  for (let i = 0; i < samples.length; i += 1) {
    const x = padX + (i / lastIdx) * plotW
    const y = midY - clamp(samples[i] * amplitudeScale, -1, 1) * halfH
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

export function SeamInspector({
  preview,
  start,
  end,
  duration,
  crossfadeMs,
  curve,
  disabled = false,
  onChangeStart,
  onChangeEnd,
  onSnapBoundary,
  onChangeCrossfade,
  onChangeCurve,
}: SeamInspectorProps) {
  const scopeWrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const maxMs = Math.min(1000, Math.max(20, Math.floor(Math.max(0.1, end - start) * 450)))
  const clampedCrossfade = clamp(Math.round(crossfadeMs), 5, maxMs)

  useEffect(() => {
    const container = scopeWrapRef.current
    if (!container) return

    const updateSize = () => {
      const rect = container.getBoundingClientRect()
      const nextW = Math.max(0, Math.round(rect.width))
      const nextH = Math.max(0, Math.round(rect.height))
      setSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH },
      )
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width <= 0 || size.height <= 0) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const { width, height } = size
    const padX = 12
    const padY = 14
    const plotW = Math.max(1, width - padX * 2)
    const midY = height / 2
    const halfH = Math.max(10, midY - padY)

    ctx.fillStyle = '#0e1013'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padX, midY - halfH * 0.5)
    ctx.lineTo(width - padX, midY - halfH * 0.5)
    ctx.moveTo(padX, midY + halfH * 0.5)
    ctx.lineTo(width - padX, midY + halfH * 0.5)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(236, 239, 244, 0.12)'
    ctx.beginPath()
    ctx.moveTo(padX, midY)
    ctx.lineTo(width - padX, midY)
    ctx.stroke()

    if (!preview || preview.blended.length < 2) {
      return
    }

    const fadeStartX = padX + clamp(preview.crossfadeStartRatio, 0, 1) * plotW
    const fadeEndX = padX + clamp(preview.crossfadeEndRatio, 0, 1) * plotW

    if (fadeEndX > fadeStartX) {
      ctx.fillStyle = 'rgba(229, 154, 60, 0.08)'
      ctx.fillRect(fadeStartX, 0, fadeEndX - fadeStartX, height)

      ctx.save()
      ctx.strokeStyle = 'rgba(229, 154, 60, 0.34)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(fadeStartX, 0)
      ctx.lineTo(fadeStartX, height)
      ctx.moveTo(fadeEndX, 0)
      ctx.lineTo(fadeEndX, height)
      ctx.stroke()
      ctx.restore()
    }

    let peakAbs = 0
    for (const s of preview.tail) {
      const a = Math.abs(s)
      if (a > peakAbs) peakAbs = a
    }
    for (const s of preview.head) {
      const a = Math.abs(s)
      if (a > peakAbs) peakAbs = a
    }
    for (const s of preview.blended) {
      const a = Math.abs(s)
      if (a > peakAbs) peakAbs = a
    }
    const amplitudeScale = peakAbs > 0.001 ? Math.min(3.2, 0.9 / peakAbs) : 1

    drawPolyline(ctx, preview.tail, padX, plotW, midY, halfH, amplitudeScale, 'rgba(229, 154, 60, 0.72)', 1.25)
    drawPolyline(ctx, preview.head, padX, plotW, midY, halfH, amplitudeScale, 'rgba(93, 163, 224, 0.72)', 1.25)
    drawPolyline(ctx, preview.blended, padX, plotW, midY, halfH, amplitudeScale, '#eceff4', 1.75)
  }, [preview, size])

  const phaseMetric = preview ? formatPhasePercent(preview.phaseCorrelation) : null
  const continuityMetric = preview ? formatContinuityPercent(preview.seamContinuity) : null

  return (
    <section className="panel seam-panel" aria-label="Инспектор стыка">
      <div className="panel-header">
        <div className="seam-header-left">
          <h2 className="panel-title">Стык</h2>
          <div className="seam-scope-legend" aria-label="Легенда осциллограммы">
            <span className="seam-legend-item">
              <i className="seam-swatch seam-swatch--tail" aria-hidden="true" />
              Конец
            </span>
            <span className="seam-legend-item">
              <i className="seam-swatch seam-swatch--head" aria-hidden="true" />
              Начало
            </span>
            <span className="seam-legend-item">
              <i className="seam-swatch seam-swatch--blended" aria-hidden="true" />
              Склейка
            </span>
          </div>
        </div>
        <div className="seam-metrics">
          <span className={`seam-metric ${phaseMetric?.tone ?? ''}`}>
            <span>Фаза</span>
            <strong>{phaseMetric ? phaseMetric.label : '—'}</strong>
          </span>
          <span className={`seam-metric ${continuityMetric?.tone ?? ''}`}>
            <span>Гладкость</span>
            <strong>{continuityMetric ? continuityMetric.label : '—'}</strong>
          </span>
        </div>
      </div>

      <div className="seam-grid">
        <div className="seam-scope">
          <div className="seam-scope-canvas-wrap" ref={scopeWrapRef}>
            <canvas
              ref={canvasRef}
              className="seam-scope-canvas"
              aria-label="Осциллограмма совмещения конца и начала петли"
            />
          </div>
        </div>

        <div className="seam-controls">
          <div className="seam-control-group">
            <div className="boundary-row">
              <div className="boundary-row-head">
                <span className="boundary-label">
                  <i className="boundary-dot boundary-dot--head" aria-hidden="true" />
                  Начало
                </span>
                <output className="boundary-value">{formatTimeDetailed(start)}</output>
              </div>
              <div className="nudge-group" role="group" aria-label="Точная подстройка начала">
                {NUDGE_STEPS_MS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    className="nudge-btn"
                    disabled={disabled}
                    title={`${step > 0 ? `+${step}` : step} мс`}
                    onClick={() => onChangeStart(clamp(start + step / 1000, 0, Math.max(0, end - 0.1)))}
                  >
                    {step > 0 ? `+${step}` : step}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn--secondary btn--icon nudge-snap-btn"
                  disabled={disabled}
                  title="Привязать к zero crossing"
                  aria-label="Привязать начало к zero crossing"
                  onClick={() => onSnapBoundary('start')}
                >
                  <Magnet size={13} strokeWidth={1.85} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="boundary-row">
              <div className="boundary-row-head">
                <span className="boundary-label">
                  <i className="boundary-dot boundary-dot--tail" aria-hidden="true" />
                  Конец
                </span>
                <output className="boundary-value">{formatTimeDetailed(end)}</output>
              </div>
              <div className="nudge-group" role="group" aria-label="Точная подстройка конца">
                {NUDGE_STEPS_MS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    className="nudge-btn"
                    disabled={disabled}
                    title={`${step > 0 ? `+${step}` : step} мс`}
                    onClick={() => onChangeEnd(clamp(end + step / 1000, start + 0.1, duration))}
                  >
                    {step > 0 ? `+${step}` : step}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn--secondary btn--icon nudge-snap-btn"
                  disabled={disabled}
                  title="Привязать к zero crossing"
                  aria-label="Привязать конец к zero crossing"
                  onClick={() => onSnapBoundary('end')}
                >
                  <Magnet size={13} strokeWidth={1.85} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          <div className="seam-divider" aria-hidden="true" />

          <div className="seam-control-group">
            <div className="seam-slider-row">
              <div className="boundary-row-head">
                <label htmlFor="seam-crossfade-slider" className="boundary-label">
                  Crossfade
                </label>
                <output htmlFor="seam-crossfade-slider" className="boundary-value">
                  {clampedCrossfade} мс
                </output>
              </div>
              <input
                id="seam-crossfade-slider"
                className="studio-range"
                type="range"
                min={5}
                max={maxMs}
                step={1}
                value={clampedCrossfade}
                disabled={disabled}
                onChange={(event) => onChangeCrossfade(Number(event.target.value))}
              />
            </div>

            <div className="seam-curve-row">
              <span className="boundary-label">Кривая</span>
              <div className="curve-toggle" role="group" aria-label="Кривая кроссфейда">
                <button
                  type="button"
                  className={`curve-toggle-btn ${curve === 'constantGain' ? 'is-active' : ''}`}
                  aria-pressed={curve === 'constantGain'}
                  disabled={disabled}
                  title="Для фазово-согласованных петель"
                  onClick={() => onChangeCurve('constantGain')}
                >
                  Constant-Gain
                </button>
                <button
                  type="button"
                  className={`curve-toggle-btn ${curve === 'equalPower' ? 'is-active' : ''}`}
                  aria-pressed={curve === 'equalPower'}
                  disabled={disabled}
                  title="Для пэдов и эмбиента"
                  onClick={() => onChangeCurve('equalPower')}
                >
                  Equal-Power
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
