import { describe, expect, it } from 'vitest'
import { applyCircularInpaint, audioBufferAsLoop, encodeWav, findBestLoop, prepareCircularInpaint, renderSeamlessLoop, trimAudioBuffer } from './audio'

describe('audio processing', () => {
  it('finds a valid loop inside the signal', () => {
    const sampleRate = 1000
    const data = Float32Array.from({ length: 4000 }, (_, i) => Math.sin((i / 100) * Math.PI * 2))
    const result = findBestLoop(data, sampleRate)
    expect(result.start).toBeGreaterThanOrEqual(0)
    expect(result.end).toBeLessThanOrEqual(data.length)
    expect(result.end - result.start).toBeGreaterThan(sampleRate * 0.2)
    expect(Number.isFinite(result.score)).toBe(true)
  })

  it('encodes a valid 16-bit PCM WAV header', () => {
    const wav = encodeWav({ channels: [new Float32Array([0, 0.5, -0.5])], sampleRate: 48000, duration: 3 / 48000 })
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(wav.byteLength).toBe(50)
  })

  it('falls back safely when a signal has no zero crossings', () => {
    const data = new Float32Array(2000).fill(0.25)
    expect(findBestLoop(data, 1000)).toEqual({ start: 0, end: 2000, score: 1 })
  })

  it('trims all channels to the requested sample range', () => {
    const source = {
      sampleRate: 10,
      length: 10,
      numberOfChannels: 1,
      getChannelData: () => Float32Array.from({ length: 10 }, (_, index) => index),
    } as AudioBuffer
    const context = {
      createBuffer: (_channels: number, length: number, sampleRate: number) => {
        const data = new Float32Array(length)
        return {
          numberOfChannels: 1,
          length,
          sampleRate,
          duration: length / sampleRate,
          copyToChannel: (input: Float32Array) => data.set(input),
          getChannelData: () => data,
        } as unknown as AudioBuffer
      },
    } as BaseAudioContext
    const trimmed = trimAudioBuffer(context, source, 0.2, 0.7)
    expect(Array.from(trimmed.getChannelData(0))).toEqual([2, 3, 4, 5, 6])
    expect(audioBufferAsLoop(trimmed).duration).toBe(0.5)
  })

  it('does not create a loudness bump while crossfading correlated audio', () => {
    const samples = new Float32Array(1000).fill(0.8)
    const buffer = {
      sampleRate: 1000,
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as AudioBuffer
    const rendered = renderSeamlessLoop(buffer, 0, 1, 100)
    expect(Math.max(...rendered.channels[0])).toBeLessThanOrEqual(0.801)
  })

  it('keeps the exported loop boundary continuous', () => {
    const samples = Float32Array.from({ length: 1000 }, (_, index) => Math.sin(index * 0.071) * 0.7)
    const buffer = {
      sampleRate: 1000,
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as AudioBuffer
    const output = renderSeamlessLoop(buffer, 0.05, 0.95, 80).channels[0]
    const seamDelta = Math.abs(output[0] - output.at(-1)!)
    const adjacentDelta = Math.abs(output[1] - output[0])
    expect(seamDelta).toBeLessThanOrEqual(adjacentDelta * 1.1 + 0.001)
  })

  it('builds a bidirectional context and preserves loop duration after inpainting', () => {
    const sampleRate = 100
    const samples = Float32Array.from({ length: 2000 }, (_, index) => Math.sin(index * 0.1))
    const buffer = {
      sampleRate,
      length: samples.length,
      duration: samples.length / sampleRate,
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as AudioBuffer
    const plan = prepareCircularInpaint(buffer, 1, 19, 0.8)!
    expect(plan).not.toBeNull()
    expect(plan.input.channels[0].slice(plan.maskStart * sampleRate, plan.maskEnd * sampleRate).every((value) => value === 0)).toBe(true)

    const generatedSamples = new Float32Array(plan.input.channels[0].length).fill(0.25)
    const generated = {
      sampleRate,
      length: generatedSamples.length,
      duration: generatedSamples.length / sampleRate,
      numberOfChannels: 1,
      getChannelData: () => generatedSamples,
    } as AudioBuffer
    const loop = applyCircularInpaint(buffer, 1, 19, generated, plan.maskStart, plan.bridgeSeconds)
    expect(loop.duration).toBeCloseTo(18, 5)
    expect(loop.channels[0].slice(-80).every((value) => value === 0.25)).toBe(true)
  })
})
