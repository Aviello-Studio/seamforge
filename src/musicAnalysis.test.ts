import { describe, expect, it } from 'vitest'
import { findMusicalLoops, nearestQuietRisingCrossing } from './musicAnalysis'

describe('musical loop analysis', () => {
  it('snaps toward a quiet rising zero crossing', () => {
    const signal = new Float32Array(200).fill(0.4)
    signal[98] = -0.03
    signal[99] = -0.01
    signal[100] = 0.002
    signal[101] = 0.02
    expect(nearestQuietRisingCrossing(signal, 1000, 104)).toBe(100)
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
