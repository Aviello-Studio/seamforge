import { describe, expect, it } from 'vitest'
import {
  findMusicalLoops,
  nearestQuietRisingCrossing,
  prioritizeLoopDurations,
  recurrencePathScore,
  refineStereoSeam,
  stereoSeamQuality,
} from './musicAnalysis'

describe('musical loop analysis', () => {
  it('snaps toward a quiet rising zero crossing', () => {
    const signal = new Float32Array(200).fill(0.4)
    signal[98] = -0.03
    signal[99] = -0.01
    signal[100] = 0.002
    signal[101] = 0.02
    expect(nearestQuietRisingCrossing(signal, 1000, 104)).toBe(100)
  })

  it('rewards a continuous recurrence diagonal over an isolated match', () => {
    const matrix = Array.from({ length: 12 }, () => new Float32Array(12))
    matrix[2][8] = matrix[8][2] = 1
    for (let offset = -2; offset <= 2; offset += 1) matrix[4 + offset][9 + offset] = matrix[9 + offset][4 + offset] = 0.9
    expect(recurrencePathScore(matrix, 4, 9, 2)).toBeGreaterThan(recurrencePathScore(matrix, 2, 8, 2))
  })

  it('preserves phrase duration without degrading the worst-channel seam', () => {
    const sampleRate = 4000
    const length = sampleRate * 2
    const left = Float32Array.from({ length }, (_, index) => Math.sin(index / sampleRate * Math.PI * 2 * 137))
    const right = Float32Array.from({ length }, (_, index) => Math.sin(index / sampleRate * Math.PI * 2 * 211 + 0.4))
    const channels = [left, right]
    const start = 900
    const end = 5193
    const before = stereoSeamQuality(channels, start, end, sampleRate)
    const refined = refineStereoSeam(channels, sampleRate, start, end)
    expect(refined.phaseScore).toBeGreaterThanOrEqual(before)
    expect(refined.end - refined.start).toBe(end - start)
    expect(Math.abs(refined.start - start)).toBeLessThanOrEqual(sampleRate * 0.02 + 1)
    expect(Math.abs(refined.end - end)).toBeLessThanOrEqual(sampleRate * 0.02 + 1)
  })

  it('keeps a long loop in the first candidates even when short matches score first', () => {
    const candidates = [
      { startIndex: 10, endIndex: 45 },
      { startIndex: 20, endIndex: 58 },
      { startIndex: 2, endIndex: 91 },
      { startIndex: 15, endIndex: 70 },
    ]
    const prioritized = prioritizeLoopDurations(candidates, 100)
    expect(prioritized.slice(0, 4)).toContain(candidates[2])
  })

  it('returns a bounded candidate for repeated musical material', async () => {
    const sampleRate = 8000
    const duration = 8
    const samples = Float32Array.from({ length: sampleRate * duration }, (_, index) => {
      const time = index / sampleRate
      const phraseTime = time % 2
      const tone = Math.sin(time * Math.PI * 2 * (phraseTime < 1 ? 220 : 330)) * 0.22
      const beatPhase = time % 0.5
      const pulse = beatPhase < 0.035 ? Math.sin(beatPhase * Math.PI * 2 * 90) * Math.exp(-beatPhase * 55) * 0.7 : 0
      return tone + pulse
    })
    const buffer = {
      sampleRate,
      duration,
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as AudioBuffer
    const candidates = await findMusicalLoops(buffer)
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0].start).toBeGreaterThanOrEqual(0)
    expect(candidates[0].end).toBeLessThanOrEqual(duration)
    expect(candidates[0].end).toBeGreaterThan(candidates[0].start)
    expect(candidates[0].crossfadeMs).toBeLessThanOrEqual(35)
  })
})
