import Meyda from 'meyda'
import { findBestLoop, mixToMono } from './audio'

export interface MusicalLoopCandidate {
  start: number
  end: number
  score: number
  confidence: number
  crossfadeMs: number
  label: string
}

interface FeatureFrame {
  chroma: number[]
  rmsDb: number
  centroid: number
  flux: number
}

type ProgressCallback = (progress: number, stage: string) => void

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  return dot / (Math.sqrt(aa * bb) + 1e-9)
}

function detectTempo(features: FeatureFrame[], sampleRate: number, hopSize: number): number {
  const framesPerSecond = sampleRate / hopSize
  const minLag = Math.max(2, Math.floor((framesPerSecond * 60) / 190))
  const maxLag = Math.min(features.length - 1, Math.ceil((framesPerSecond * 60) / 55))
  const mean = features.reduce((sum, frame) => sum + frame.flux, 0) / Math.max(1, features.length)
  let bestLag = Math.round((framesPerSecond * 60) / 120)
  let bestScore = -Infinity

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0
    for (let i = lag; i < features.length; i += 1) {
      const a = Math.max(0, features[i].flux - mean)
      const b = Math.max(0, features[i - lag].flux - mean)
      score += a * b
    }
    const preferredTempo = (framesPerSecond * 60) / lag
    score *= 1 - Math.abs(preferredTempo - 120) / 1200
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  return Math.max(2, bestLag)
}

function detectBeatFrames(features: FeatureFrame[], period: number): number[] {
  if (features.length < 3) return [0, Math.max(0, features.length - 1)]
  const peaks: number[] = []
  for (let i = 2; i < features.length - 2; i += 1) {
    let localMean = 0
    let count = 0
    for (let j = Math.max(0, i - period); j <= Math.min(features.length - 1, i + period); j += 1) {
      localMean += features[j].flux
      count += 1
    }
    localMean /= count
    if (
      features[i].flux > localMean * 1.3 + 1e-5 &&
      features[i].flux >= features[i - 1].flux &&
      features[i].flux >= features[i + 1].flux
    ) peaks.push(i)
  }

  const anchor = peaks.reduce((best, frame) => features[frame].flux > features[best]?.flux ? frame : best, peaks[0] ?? 0)
  const beats: number[] = []
  for (let expected = anchor; expected >= 0; expected -= period) {
    const radius = Math.max(1, Math.round(period * 0.24))
    let best = Math.round(expected)
    for (let frame = Math.max(0, best - radius); frame <= Math.min(features.length - 1, best + radius); frame += 1) {
      if (features[frame].flux > features[best].flux) best = frame
    }
    beats.push(best)
  }
  for (let expected = anchor + period; expected < features.length; expected += period) {
    const radius = Math.max(1, Math.round(period * 0.24))
    let best = Math.round(expected)
    for (let frame = Math.max(0, best - radius); frame <= Math.min(features.length - 1, best + radius); frame += 1) {
      if (features[frame].flux > features[best].flux) best = frame
    }
    beats.push(best)
  }
  return [...new Set(beats)].sort((a, b) => a - b)
}

function sequenceSimilarity(features: FeatureFrame[], a: number, b: number, span: number, direction: 1 | -1): number {
  let total = 0
  let weightTotal = 0
  for (let step = 0; step < span; step += 1) {
    const ai = a + step * direction
    const bi = b + step * direction
    if (ai < 0 || bi < 0 || ai >= features.length || bi >= features.length) break
    const weight = Math.pow(0.985, step)
    const chromaScore = Math.max(0, cosine(features[ai].chroma, features[bi].chroma))
    const loudnessScore = Math.exp(-Math.abs(features[ai].rmsDb - features[bi].rmsDb) / 7)
    const centroidScale = Math.max(250, features[ai].centroid, features[bi].centroid)
    const timbreScore = Math.exp(-Math.abs(features[ai].centroid - features[bi].centroid) / centroidScale)
    total += (chromaScore * 0.68 + loudnessScore * 0.2 + timbreScore * 0.12) * weight
    weightTotal += weight
  }
  return weightTotal ? total / weightTotal : 0
}

export function nearestQuietRisingCrossing(data: Float32Array, sampleRate: number, target: number): number {
  const radius = Math.max(1, Math.round(sampleRate * 0.012))
  const from = Math.max(1, target - radius)
  const to = Math.min(data.length - 2, target + radius)
  let best = clamp(target, from, to)
  let bestCost = Infinity
  for (let i = from; i <= to; i += 1) {
    const rising = data[i - 1] <= 0 && data[i] >= 0
    const downward = data[i - 1] >= 0 && data[i] <= 0
    const crossingPenalty = rising ? 0 : downward ? 0.12 : 0.45
    let localEnergy = 0
    for (let offset = -3; offset <= 3; offset += 1) localEnergy += Math.abs(data[clamp(i + offset, 0, data.length - 1)])
    const distancePenalty = Math.abs(i - target) / radius * 0.1
    const cost = crossingPenalty + localEnergy / 7 + distancePenalty
    if (cost < bestCost) {
      bestCost = cost
      best = i
    }
  }
  return best
}

function fallbackCandidate(buffer: AudioBuffer): MusicalLoopCandidate {
  const result = findBestLoop(mixToMono(buffer), buffer.sampleRate)
  return {
    start: result.start / buffer.sampleRate,
    end: result.end / buffer.sampleRate,
    score: result.score,
    confidence: Math.round(clamp(78 - result.score * 35, 10, 78)),
    crossfadeMs: 35,
    label: 'Waveform fallback',
  }
}

export async function findMusicalLoops(buffer: AudioBuffer, onProgress?: ProgressCallback): Promise<MusicalLoopCandidate[]> {
  const mono = mixToMono(buffer)
  const frameSize = buffer.sampleRate >= 32_000 ? 4096 : 2048
  const hopSize = frameSize / 2
  const frameCount = Math.floor((mono.length - frameSize) / hopSize) + 1
  if (frameCount < 16) return [fallbackCandidate(buffer)]

  Meyda.bufferSize = frameSize
  Meyda.sampleRate = buffer.sampleRate
  Meyda.chromaBands = 12
  Meyda.windowingFunction = 'hanning'
  const features: FeatureFrame[] = []
  let previousSpectrum: Float32Array | null = null

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const offset = frameIndex * hopSize
    const frame = mono.subarray(offset, offset + frameSize)
    const extracted = Meyda.extract(['chroma', 'rms', 'spectralCentroid', 'amplitudeSpectrum'], frame)
    if (!extracted?.chroma || extracted.rms === undefined || extracted.spectralCentroid === undefined || !extracted.amplitudeSpectrum) continue
    let flux = 0
    if (previousSpectrum) {
      for (let i = 0; i < extracted.amplitudeSpectrum.length; i += 1) {
        flux += Math.max(0, extracted.amplitudeSpectrum[i] - previousSpectrum[i])
      }
      flux /= extracted.amplitudeSpectrum.length
    }
    features.push({
      chroma: extracted.chroma,
      rmsDb: 20 * Math.log10(extracted.rms + 1e-7),
      centroid: extracted.spectralCentroid,
      flux,
    })
    previousSpectrum = extracted.amplitudeSpectrum
    if (frameIndex % 48 === 0) {
      onProgress?.(frameIndex / frameCount * 0.58, 'Извлекаю chroma и спектральные признаки')
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    }
  }

  if (features.length < 16) return [fallbackCandidate(buffer)]
  onProgress?.(0.62, 'Строю beat-сетку')
  const period = detectTempo(features, buffer.sampleRate, hopSize)
  const beats = detectBeatFrames(features, period)
  const minLoopFrames = Math.max(period * 4, Math.floor(features.length * 0.35))
  const sequenceSpan = Math.min(Math.round(period * 12), Math.floor(features.length * 0.25))
  const rawCandidates: Array<{ startFrame: number; endFrame: number; score: number }> = []

  for (let endIndex = 1; endIndex < beats.length; endIndex += 1) {
    const endFrame = beats[endIndex]
    for (let startIndex = 0; startIndex < endIndex; startIndex += 1) {
      const startFrame = beats[startIndex]
      if (endFrame - startFrame < minLoopFrames) continue
      const chromaScore = Math.max(0, cosine(features[startFrame].chroma, features[endFrame].chroma))
      const loudnessDifference = Math.abs(features[startFrame].rmsDb - features[endFrame].rmsDb)
      if (chromaScore < 0.62 || loudnessDifference > 9) continue
      const forward = sequenceSimilarity(features, startFrame, endFrame, sequenceSpan, 1)
      const backward = sequenceSimilarity(features, startFrame, endFrame, sequenceSpan, -1)
      const continuation = Math.max(forward, backward)
      const durationPreference = Math.min(1, (endFrame - startFrame) / Math.max(1, features.length * 0.75))
      const score = chromaScore * 0.34 + continuation * 0.52 + Math.exp(-loudnessDifference / 6) * 0.1 + durationPreference * 0.04
      rawCandidates.push({ startFrame, endFrame, score })
    }
    if (endIndex % 24 === 0) {
      onProgress?.(0.62 + endIndex / beats.length * 0.28, 'Сравниваю музыкальные фразы')
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    }
  }

  if (!rawCandidates.length) return [fallbackCandidate(buffer)]
  rawCandidates.sort((a, b) => b.score - a.score)
  const selected: MusicalLoopCandidate[] = []
  const minimumSeparation = buffer.sampleRate * 0.35
  for (const candidate of rawCandidates) {
    const rawStart = candidate.startFrame * hopSize
    const rawEnd = candidate.endFrame * hopSize
    const startSample = nearestQuietRisingCrossing(mono, buffer.sampleRate, rawStart)
    const endSample = nearestQuietRisingCrossing(mono, buffer.sampleRate, rawEnd)
    if (selected.some((existing) =>
      Math.abs(existing.start * buffer.sampleRate - startSample) < minimumSeparation &&
      Math.abs(existing.end * buffer.sampleRate - endSample) < minimumSeparation,
    )) continue
    const localFlux = (features[candidate.startFrame].flux + features[candidate.endFrame].flux) * 0.5
    const crossfadeMs = localFlux > 0.01 ? 8 : localFlux > 0.003 ? 15 : 25
    selected.push({
      start: startSample / buffer.sampleRate,
      end: endSample / buffer.sampleRate,
      score: 1 - candidate.score,
      confidence: Math.round(clamp(candidate.score * 100, 1, 99)),
      crossfadeMs,
      label: `Музыкальный кандидат ${selected.length + 1}`,
    })
    if (selected.length === 5) break
  }
  onProgress?.(1, 'Готово')
  return selected.length ? selected : [fallbackCandidate(buffer)]
}
