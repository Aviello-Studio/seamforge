import Meyda from 'meyda'
import { findBestLoop, mixToMono } from './audio'

export interface MusicalLoopCandidate {
  start: number
  end: number
  score: number
  confidence: number
  crossfadeMs: number
  label: string
  diagnostics?: {
    musical: number
    recurrence: number
    rhythm: number
    phase: number
    vocal?: number
  }
}

export interface LoopAnalysisOptions {
  vocalBuffer?: AudioBuffer
  exhaustive?: boolean
}

interface FeatureFrame {
  chroma: number[]
  rmsDb: number
  centroid: number
  flux: number
}

interface MeterGrid {
  beatsPerBar: 3 | 4
  downbeatOffset: number
  confidence: number
}

export interface RefinedSeam {
  start: number
  end: number
  phaseScore: number
}

interface VocalActivityProfile {
  envelope: Float32Array
  hopSize: number
  referenceRms: number
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

function featureSimilarity(a: FeatureFrame, b: FeatureFrame): number {
  const chroma = Math.max(0, cosine(a.chroma, b.chroma))
  const loudness = Math.exp(-Math.abs(a.rmsDb - b.rmsDb) / 7)
  const centroidScale = Math.max(250, a.centroid, b.centroid)
  const timbre = Math.exp(-Math.abs(a.centroid - b.centroid) / centroidScale)
  const fluxScale = Math.max(0.002, a.flux, b.flux)
  const transient = Math.exp(-Math.abs(a.flux - b.flux) / fluxScale)
  return chroma * 0.57 + loudness * 0.17 + timbre * 0.14 + transient * 0.12
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

function beatSyncFeatures(features: FeatureFrame[], beats: number[], period: number): FeatureFrame[] {
  const radius = Math.max(1, Math.round(period * 0.42))
  return beats.map((beat) => {
    const chroma = new Array(12).fill(0) as number[]
    let rmsLinear = 0
    let centroid = 0
    let flux = 0
    let weightTotal = 0
    for (let frame = Math.max(0, beat - radius); frame <= Math.min(features.length - 1, beat + radius); frame += 1) {
      const weight = 1 - Math.abs(frame - beat) / (radius + 1) * 0.45
      for (let band = 0; band < 12; band += 1) chroma[band] += features[frame].chroma[band] * weight
      rmsLinear += Math.pow(10, features[frame].rmsDb / 20) * weight
      centroid += features[frame].centroid * weight
      flux = Math.max(flux, features[frame].flux)
      weightTotal += weight
    }
    return {
      chroma: chroma.map((value) => value / Math.max(1e-9, weightTotal)),
      rmsDb: 20 * Math.log10(rmsLinear / Math.max(1e-9, weightTotal) + 1e-7),
      centroid: centroid / Math.max(1e-9, weightTotal),
      flux,
    }
  })
}

function detectMeter(beats: FeatureFrame[]): MeterGrid {
  let best: MeterGrid = { beatsPerBar: 4, downbeatOffset: 0, confidence: 0 }
  const meanFlux = beats.reduce((sum, beat) => sum + beat.flux, 0) / Math.max(1, beats.length)
  for (const meter of [3, 4] as const) {
    for (let offset = 0; offset < meter; offset += 1) {
      let accented = 0
      let other = 0
      let accentedCount = 0
      let otherCount = 0
      beats.forEach((beat, index) => {
        if (index % meter === offset) {
          accented += beat.flux
          accentedCount += 1
        } else {
          other += beat.flux
          otherCount += 1
        }
      })
      const contrast = ((accented / Math.max(1, accentedCount)) - (other / Math.max(1, otherCount))) / (meanFlux + 1e-6)
      const confidence = clamp(0.5 + contrast * 0.35 + (meter === 4 ? 0.015 : 0), 0, 1)
      if (confidence > best.confidence) best = { beatsPerBar: meter, downbeatOffset: offset, confidence }
    }
  }
  return best
}

function buildRecurrenceMatrix(features: FeatureFrame[]): Float32Array[] {
  const matrix = Array.from({ length: features.length }, () => new Float32Array(features.length))
  for (let row = 0; row < features.length; row += 1) {
    matrix[row][row] = 1
    for (let column = row + 1; column < features.length; column += 1) {
      const score = featureSimilarity(features[row], features[column])
      matrix[row][column] = score
      matrix[column][row] = score
    }
  }
  return matrix
}

export function recurrencePathScore(matrix: ArrayLike<ArrayLike<number>>, a: number, b: number, span: number): number {
  let weighted = 0
  let weightTotal = 0
  let continuity = 0
  let count = 0
  for (let step = -span; step <= span; step += 1) {
    const ai = a + step
    const bi = b + step
    if (ai < 0 || bi < 0 || ai >= matrix.length || bi >= matrix.length) continue
    const weight = Math.pow(0.92, Math.abs(step))
    const value = matrix[ai][bi] ?? 0
    weighted += value * weight
    weightTotal += weight
    if (value >= 0.72) continuity += 1
    count += 1
  }
  if (!weightTotal) return 0
  return clamp(weighted / weightTotal * 0.82 + continuity / Math.max(1, count) * 0.18, 0, 1)
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

function channelSeamScore(channel: Float32Array, start: number, end: number, window: number): number {
  const stride = Math.max(1, Math.floor(window / 160))
  let dot = 0
  let energyA = 0
  let energyB = 0
  let count = 0
  for (let offset = 0; offset < window; offset += stride) {
    const a = channel[end - window + offset]
    const b = channel[start + offset]
    dot += a * b
    energyA += a * a
    energyB += b * b
    count += 1
  }
  const correlation = clamp(dot / (Math.sqrt(energyA * energyB) + 1e-9), -1, 1)
  const rmsA = Math.sqrt(energyA / Math.max(1, count))
  const rmsB = Math.sqrt(energyB / Math.max(1, count))
  const scale = Math.max(0.015, rmsA, rmsB)
  const loudness = Math.exp(-Math.abs(rmsA - rmsB) / (scale + 0.01))
  const boundary = Math.exp(-Math.abs(channel[end - 1] - channel[start]) / scale)
  const slopeA = channel[end - 1] - channel[end - 2]
  const slopeB = channel[start + 1] - channel[start]
  const slope = Math.exp(-Math.abs(slopeA - slopeB) / scale)
  return clamp((correlation + 1) * 0.36 + loudness * 0.14 + boundary * 0.09 + slope * 0.05, 0, 1)
}

export function stereoSeamQuality(channels: Float32Array[], start: number, end: number, sampleRate: number): number {
  const safeStart = clamp(Math.round(start), 1, channels[0].length - 3)
  const safeEnd = clamp(Math.round(end), safeStart + 3, channels[0].length)
  const window = Math.max(16, Math.min(Math.round(sampleRate * 0.025), safeEnd - 1, safeEnd - safeStart - 1, channels[0].length - safeStart))
  const scores = channels.map((channel) => channelSeamScore(channel, safeStart, safeEnd, window))
  const average = scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length)
  return clamp(average * 0.7 + Math.min(...scores) * 0.3, 0, 1)
}

function windowRms(data: Float32Array, center: number, radius: number): number {
  const from = clamp(center - radius, 0, data.length)
  const to = clamp(center + radius, from + 1, data.length)
  const stride = Math.max(1, Math.floor((to - from) / 500))
  let energy = 0
  let count = 0
  for (let index = from; index < to; index += stride) {
    energy += data[index] * data[index]
    count += 1
  }
  return Math.sqrt(energy / Math.max(1, count))
}

function scoreVocalLevels(startRms: number, endRms: number, referenceRms: number): number {
  const loudest = Math.max(startRms, endRms)
  const relativeLevel = loudest / Math.max(0.004, referenceRms)
  const quiet = Math.exp(-relativeLevel / 0.34)
  const balance = Math.exp(-Math.abs(startRms - endRms) / (loudest + referenceRms * 0.08 + 1e-6))
  return clamp(Math.max(quiet, balance * 0.3), 0, 1)
}

function createVocalActivityProfile(data: Float32Array, sampleRate: number): VocalActivityProfile {
  const hopSize = Math.max(1, Math.round(sampleRate * 0.01))
  const radius = Math.max(16, Math.round(sampleRate * 0.14))
  const envelope = new Float32Array(Math.max(1, Math.ceil(data.length / hopSize)))
  for (let index = 0; index < envelope.length; index += 1) {
    envelope[index] = windowRms(data, clamp(index * hopSize, radius, data.length - radius), radius)
  }
  const sorted = Array.from(envelope).sort((a, b) => a - b)
  const referenceRms = Math.max(0.004, sorted[Math.floor((sorted.length - 1) * 0.82)] ?? 0.004)
  return { envelope, hopSize, referenceRms }
}

function profileVocalSafety(profile: VocalActivityProfile, start: number, end: number): number {
  const at = (sample: number) => profile.envelope[clamp(Math.round(sample / profile.hopSize), 0, profile.envelope.length - 1)]
  return scoreVocalLevels(at(start), at(end), profile.referenceRms)
}

/** Scores whether both boundaries avoid an active separated vocal phrase. */
export function vocalBoundarySafety(data: Float32Array, sampleRate: number, start: number, end: number): number {
  const radius = Math.max(16, Math.round(sampleRate * 0.14))
  const startRms = windowRms(data, clamp(Math.round(start), radius, data.length - radius), radius)
  const endRms = windowRms(data, clamp(Math.round(end), radius, data.length - radius), radius)
  const reference = createVocalActivityProfile(data, sampleRate).referenceRms
  return scoreVocalLevels(startRms, endRms, reference)
}

function refineVocalAwareSeam(
  channels: Float32Array[],
  sampleRate: number,
  start: number,
  end: number,
  vocalProfile: VocalActivityProfile,
  vocalScale: number,
): RefinedSeam & { vocalSafety: number } {
  const phaseRefined = refineStereoSeam(channels, sampleRate, start, end)
  const radius = Math.max(1, Math.round(sampleRate * 0.24))
  const step = Math.max(1, Math.round(sampleRate * 0.008))
  let bestStart = phaseRefined.start
  let bestEnd = phaseRefined.end
  let bestPhase = phaseRefined.phaseScore
  let bestVocal = profileVocalSafety(vocalProfile, bestStart * vocalScale, bestEnd * vocalScale)
  let bestRank = bestPhase * 0.34 + bestVocal * 0.66

  for (let offset = -radius; offset <= radius; offset += step) {
    const candidateStart = Math.round(start + offset)
    const candidateEnd = Math.round(end + offset)
    if (candidateStart < 1 || candidateEnd > channels[0].length) continue
    const phase = stereoSeamQuality(channels, candidateStart, candidateEnd, sampleRate)
    const vocal = profileVocalSafety(vocalProfile, candidateStart * vocalScale, candidateEnd * vocalScale)
    const movementPenalty = Math.abs(offset) / radius * 0.025
    const rank = phase * 0.34 + vocal * 0.66 - movementPenalty
    if (rank > bestRank) {
      bestRank = rank
      bestStart = candidateStart
      bestEnd = candidateEnd
      bestPhase = phase
      bestVocal = vocal
    }
  }
  return { start: bestStart, end: bestEnd, phaseScore: bestPhase, vocalSafety: bestVocal }
}

export function refineStereoSeam(channels: Float32Array[], sampleRate: number, start: number, end: number): RefinedSeam {
  const length = channels[0].length
  const radius = Math.max(2, Math.round(sampleRate * 0.02))
  const coarseStep = Math.max(1, Math.round(sampleRate * 0.001))
  let bestStart = clamp(Math.round(start), 1, length - 3)
  let bestEnd = clamp(Math.round(end), bestStart + 3, length)
  let bestRank = stereoSeamQuality(channels, bestStart, bestEnd, sampleRate)

  const evaluate = (candidateStart: number, candidateEnd: number) => {
    if (candidateStart < 1 || candidateEnd > length || candidateEnd - candidateStart < sampleRate * 0.2) return
    const phase = stereoSeamQuality(channels, candidateStart, candidateEnd, sampleRate)
    const movement = Math.abs(candidateStart - start) / Math.max(1, radius)
    const rank = phase - movement * 0.025
    if (rank > bestRank) {
      bestRank = rank
      bestStart = candidateStart
      bestEnd = candidateEnd
    }
  }

  // Shift both boundaries together so the musical duration stays exact. Independent
  // movement can drop or repeat up to 40 ms of a vocal phrase on every wrap.
  for (let offset = -radius; offset <= radius; offset += coarseStep) evaluate(Math.round(start + offset), Math.round(end + offset))
  const coarseStart = bestStart
  const coarseEnd = bestEnd
  for (let offset = -coarseStep; offset <= coarseStep; offset += 1) evaluate(coarseStart + offset, coarseEnd + offset)
  return { start: bestStart, end: bestEnd, phaseScore: stereoSeamQuality(channels, bestStart, bestEnd, sampleRate) }
}

export function prioritizeLoopDurations<T extends { startIndex: number; endIndex: number }>(candidates: T[], totalBeats: number): T[] {
  if (!candidates.length) return []
  const ratio = (candidate: T) => (candidate.endIndex - candidate.startIndex) / Math.max(1, totalBeats - 1)
  const anchors = [
    candidates[0],
    candidates.find((candidate) => ratio(candidate) >= 0.72),
    candidates.find((candidate) => ratio(candidate) >= 0.5 && ratio(candidate) < 0.72),
    candidates.find((candidate) => ratio(candidate) >= 0.3 && ratio(candidate) < 0.5),
  ].filter((candidate): candidate is T => Boolean(candidate))
  const seen = new Set<string>()
  return [...anchors, ...candidates].filter((candidate) => {
    const key = `${candidate.startIndex}:${candidate.endIndex}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

export async function findMusicalLoops(
  buffer: AudioBuffer,
  onProgress?: ProgressCallback,
  options: LoopAnalysisOptions = {},
): Promise<MusicalLoopCandidate[]> {
  const mono = mixToMono(buffer)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
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
      onProgress?.(frameIndex / frameCount * 0.5, 'Извлекаю многомасштабные признаки')
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    }
  }

  if (features.length < 16) return [fallbackCandidate(buffer)]
  onProgress?.(0.53, 'Строю beat- и bar-сетку')
  const period = detectTempo(features, buffer.sampleRate, hopSize)
  const beats = detectBeatFrames(features, period)
  const beatFeatures = beatSyncFeatures(features, beats, period)
  const meter = detectMeter(beatFeatures)
  const recurrence = buildRecurrenceMatrix(beatFeatures)
  const minimumBeats = Math.max(meter.beatsPerBar * 2, Math.floor(beats.length * 0.3))
  const pathSpan = Math.max(2, Math.min(meter.beatsPerBar * 3, Math.floor(beats.length * 0.2)))
  const rawCandidates: Array<{ startIndex: number; endIndex: number; score: number; recurrence: number; rhythm: number }> = []

  for (let endIndex = 1; endIndex < beats.length; endIndex += 1) {
    for (let startIndex = 0; startIndex < endIndex; startIndex += 1) {
      const beatDistance = endIndex - startIndex
      if (beatDistance < minimumBeats) continue
      const harmonic = Math.max(0, cosine(beatFeatures[startIndex].chroma, beatFeatures[endIndex].chroma))
      const loudnessDifference = Math.abs(beatFeatures[startIndex].rmsDb - beatFeatures[endIndex].rmsDb)
      if (harmonic < 0.58 || loudnessDifference > 10) continue
      const path = recurrencePathScore(recurrence, startIndex, endIndex, pathSpan)
      const sameBarPhase = beatDistance % meter.beatsPerBar === 0
      const onDownbeat = startIndex % meter.beatsPerBar === meter.downbeatOffset && endIndex % meter.beatsPerBar === meter.downbeatOffset
      const rhythm = sameBarPhase ? (onDownbeat ? 1 : 0.82) : 0.28
      const durationPreference = Math.min(1, beatDistance / Math.max(1, beats.length * 0.72))
      const score = harmonic * 0.25 + path * 0.48 + Math.exp(-loudnessDifference / 6) * 0.1 + rhythm * 0.13 + durationPreference * 0.04
      rawCandidates.push({ startIndex, endIndex, score, recurrence: path, rhythm })
    }
    if (endIndex % 20 === 0) {
      onProgress?.(0.56 + endIndex / beats.length * 0.26, 'Ищу диагонали повторяющихся фраз')
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    }
  }

  if (!rawCandidates.length) return [fallbackCandidate(buffer)]
  rawCandidates.sort((a, b) => b.score - a.score)
  const prioritizedCandidates = prioritizeLoopDurations(rawCandidates, beats.length)
  const evaluated: MusicalLoopCandidate[] = []
  const minimumSeparation = buffer.sampleRate * 0.35
  const vocalMono = options.vocalBuffer ? mixToMono(options.vocalBuffer) : null
  const vocalScale = options.vocalBuffer ? options.vocalBuffer.length / buffer.length : 1
  const vocalProfile = vocalMono && options.vocalBuffer
    ? createVocalActivityProfile(vocalMono, options.vocalBuffer.sampleRate)
    : null
  const candidateLimit = options.exhaustive ? 600 : 120
  for (const candidate of prioritizedCandidates.slice(0, candidateLimit)) {
    const rawStart = beats[candidate.startIndex] * hopSize
    const rawEnd = beats[candidate.endIndex] * hopSize
    // Keep the exact beat-to-beat duration. Snapping both ends independently to
    // zero crossings can remove or repeat syllable fragments on every loop.
    const refined = vocalProfile
      ? refineVocalAwareSeam(channels, buffer.sampleRate, rawStart, rawEnd, vocalProfile, vocalScale)
      : refineStereoSeam(channels, buffer.sampleRate, rawStart, rawEnd)
    const localFlux = (beatFeatures[candidate.startIndex].flux + beatFeatures[candidate.endIndex].flux) * 0.5
    const baseCrossfadeMs = refined.phaseScore > 0.9 ? 8 : refined.phaseScore > 0.78 || localFlux > 0.01 ? 15 : 25
    const vocal = vocalProfile
      ? (refined as RefinedSeam & { vocalSafety: number }).vocalSafety
      : undefined
    const crossfadeMs = vocal === undefined ? baseCrossfadeMs : Math.max(baseCrossfadeMs, Math.round(45 + (1 - vocal) * 180))
    const combined = vocal === undefined
      ? candidate.score * 0.72 + refined.phaseScore * 0.28
      : (candidate.score * 0.68 + refined.phaseScore * 0.32) * (0.55 + vocal * 0.45)
    evaluated.push({
      start: refined.start / buffer.sampleRate,
      end: refined.end / buffer.sampleRate,
      score: 1 - combined,
      confidence: Math.round(clamp(12 + combined * 86, 1, 98)),
      crossfadeMs,
      label: vocal === undefined ? 'Fast Pro' : 'AI Studio',
      diagnostics: {
        musical: candidate.score,
        recurrence: candidate.recurrence,
        rhythm: candidate.rhythm,
        phase: refined.phaseScore,
        vocal,
      },
    })
    if (evaluated.length % 32 === 0) {
      onProgress?.(0.84 + evaluated.length / candidateLimit * 0.15, vocalMono ? 'ИИ отбрасывает стыки внутри вокала' : 'Подгоняю фазу стереоканалов')
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    }
  }
  evaluated.sort((a, b) => a.score - b.score)
  const selected: MusicalLoopCandidate[] = []
  for (const candidate of evaluated) {
    if (selected.some((existing) =>
      Math.abs(existing.start - candidate.start) * buffer.sampleRate < minimumSeparation &&
      Math.abs(existing.end - candidate.end) * buffer.sampleRate < minimumSeparation,
    )) continue
    selected.push({ ...candidate, label: `${candidate.label} ${selected.length + 1}` })
    if (selected.length === 5) break
  }
  onProgress?.(1, 'Готово')
  return selected.length ? selected : [fallbackCandidate(buffer)]
}
