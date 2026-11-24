export type CrossfadeCurve = 'constantGain' | 'equalPower'

export type WavFormat = 'pcm16' | 'pcm24' | 'float32'

export interface AudioSummary {
  fileName: string
  filePath: string
  sampleRate: number
  channels: number
  duration: number
  bitDepth: number | null
  formatLabel: string
  peaks: [number, number][]
}

export interface CandidateDiagnostics {
  harmony: number
  recurrence: number
  rhythm: number
  phase: number
  timbre: number
}

export interface LoopCandidate {
  id: number
  start: number
  end: number
  loopDuration: number
  confidence: number
  crossfadeMs: number
  curve: CrossfadeCurve
  bars: number | null
  diagnostics: CandidateDiagnostics
}

export interface AnalysisResult {
  bpm: number
  beatsPerBar: number
  beatTimes: number[]
  candidates: LoopCandidate[]
}

export interface AnalysisProgressEvent {
  progress: number
  stage: string
}

export interface SeamPreviewData {
  tail: number[]
  head: number[]
  blended: number[]
  crossfadeStartRatio: number
  crossfadeEndRatio: number
  phaseCorrelation: number
  seamContinuity: number
  loopDuration: number
}

export type PlaybackMode = 'idle' | 'loop' | 'trim'

export interface PlaybackState {
  playing: boolean
  mode: PlaybackMode
  positionSec: number
  loopOffsetSec: number
  loopDurationSec: number
  audioAvailable: boolean
}
