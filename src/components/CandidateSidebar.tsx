import { Sparkles, X } from 'lucide-react'
import type { LoopCandidate } from '../api/types'
import { clamp, formatTime } from '../lib/format'
import { formatBarsLocalized, translateAnalysisStage, useI18n } from '../lib/i18n'

export interface CandidateSidebarProps {
  candidates: LoopCandidate[]
  selectedId: number | null
  analyzing: boolean
  progress: number
  progressStage: string
  bpm: number | null
  beatsPerBar: number | null
  hasAudio: boolean
  onAnalyze: () => void
  onCancelAnalysis: () => void
  onSelectCandidate: (candidate: LoopCandidate) => void
}

function toPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  const normalized = value <= 1.001 ? value * 100 : value
  return Math.round(clamp(normalized, 0, 100))
}

function confidenceTier(confidence: number): 'is-high' | 'is-mid' | 'is-low' {
  if (confidence >= 85) return 'is-high'
  if (confidence >= 65) return 'is-mid'
  return 'is-low'
}

export function CandidateSidebar({
  candidates,
  selectedId,
  analyzing,
  progress,
  progressStage,
  bpm,
  beatsPerBar,
  hasAudio,
  onAnalyze,
  onCancelAnalysis,
  onSelectCandidate,
}: CandidateSidebarProps) {
  const { locale, t } = useI18n()
  const progressPct = Math.round(clamp(progress, 0, 1) * 100)
  const translatedStage = translateAnalysisStage(progressStage, t) || t.sidebarAnalyzingFallback

  return (
    <section className="panel sidebar-panel" aria-label={t.sidebarRegionAria}>
      <div className="panel-header sidebar-header">
        <h2 className="panel-title">{t.sidebarTitle}</h2>
        {bpm !== null && (
          <span className="chip chip--accent">
            {bpm.toFixed(1)} BPM{beatsPerBar ? ` · ${beatsPerBar}/4` : ''}
          </span>
        )}
      </div>

      <div className="sidebar-action">
        {analyzing ? (
          <div className="analysis-progress" role="status" aria-live="polite">
            <div className="analysis-progress-meta">
              <span className="analysis-progress-stage">{translatedStage}</span>
              <span className="analysis-progress-pct">{progressPct}%</span>
            </div>
            <div
              className="analysis-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
            >
              <div
                className="analysis-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <button
              type="button"
              className="btn btn--secondary sidebar-action-btn"
              onClick={onCancelAnalysis}
            >
              <X size={14} strokeWidth={1.85} aria-hidden="true" />
              <span>{t.sidebarCancel}</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--primary sidebar-action-btn"
            onClick={onAnalyze}
            disabled={!hasAudio}
          >
            <Sparkles size={14} strokeWidth={1.85} aria-hidden="true" />
            <span>{t.sidebarFindSeams}</span>
          </button>
        )}
      </div>

      {candidates.length === 0 ? (
        <div className="sidebar-empty">
          <p>{analyzing ? t.sidebarEmptyAnalyzing : t.sidebarEmptyIdle}</p>
        </div>
      ) : (
        <div className="candidate-list" role="list">
          {candidates.map((candidate, index) => {
            const isSelected = selectedId === candidate.id
            const conf = Math.round(clamp(candidate.confidence, 0, 100))
            const curveShort = candidate.curve === 'constantGain' ? 'CG' : 'EP'
            const curveTitle =
              candidate.curve === 'constantGain' ? 'Constant-Gain' : 'Equal-Power'

            const diagRows = isSelected
              ? [
                  { label: t.sidebarDiagHarmony, value: toPercent(candidate.diagnostics.harmony) },
                  { label: t.sidebarDiagPhrase, value: toPercent(candidate.diagnostics.recurrence) },
                  { label: t.sidebarDiagRhythm, value: toPercent(candidate.diagnostics.rhythm) },
                  { label: t.sidebarDiagPhase, value: toPercent(candidate.diagnostics.phase) },
                ]
              : []

            return (
              <button
                key={candidate.id}
                type="button"
                role="listitem"
                className={`candidate-card ${isSelected ? 'is-selected' : ''}`}
                aria-pressed={isSelected}
                onClick={() => onSelectCandidate(candidate)}
              >
                <div className="candidate-card-top">
                  <span className="candidate-index">
                    <kbd className="kbd">{index + 1}</kbd>
                    <span className="candidate-card-range">
                      {formatTime(candidate.start)} → {formatTime(candidate.end)}
                    </span>
                  </span>
                  <span className={`candidate-confidence ${confidenceTier(conf)}`}>
                    {conf}%
                  </span>
                </div>

                <div className="candidate-card-meta">
                  <span>
                    {candidate.bars !== null ? `${formatBarsLocalized(candidate.bars, locale)} · ` : ''}
                    {formatTime(candidate.loopDuration)}
                  </span>
                  <span className="candidate-card-fade" title={curveTitle}>
                    {Math.round(candidate.crossfadeMs)} {t.unitMs} · {curveShort}
                  </span>
                </div>

                {isSelected && (
                  <div className="diag-grid" aria-label={t.sidebarDiagAria}>
                    {diagRows.map((row) => (
                      <div key={row.label} className="diag-row">
                        <div className="diag-row-head">
                          <span className="diag-label">{row.label}</span>
                          <span className="diag-value">{row.value}%</span>
                        </div>
                        <span className="diag-bar" aria-hidden="true">
                          <span
                            className="diag-bar-fill"
                            style={{ width: `${row.value}%` }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
