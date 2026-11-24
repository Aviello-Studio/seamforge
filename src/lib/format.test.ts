import { describe, expect, it } from 'vitest'
import {
  clamp,
  defaultExportFileName,
  formatSampleRate,
  formatTime,
  formatTimeDetailed,
} from './format'

describe('clamp', () => {
  it('clamps values within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('handles NaN and infinities safely', () => {
    expect(clamp(Number.NaN, 2, 8)).toBe(2)
    expect(clamp(Number.POSITIVE_INFINITY, 2, 8)).toBe(8)
    expect(clamp(Number.NEGATIVE_INFINITY, 2, 8)).toBe(2)
  })
})

describe('formatTime', () => {
  it('formats zero, negative, and non-finite inputs safely', () => {
    expect(formatTime(0)).toBe('0:00.00')
    expect(formatTime(-4.25)).toBe('0:00.00')
    expect(formatTime(Number.NaN)).toBe('0:00.00')
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00.00')
  })

  it('formats sub-second, multi-second, and minute durations', () => {
    expect(formatTime(0.05)).toBe('0:00.05')
    expect(formatTime(0.5)).toBe('0:00.50')
    expect(formatTime(9.124)).toBe('0:09.12')
    expect(formatTime(59.999)).toBe('1:00.00')
    expect(formatTime(125.4)).toBe('2:05.40')
  })
})

describe('formatTimeDetailed', () => {
  it('formats zero, negative, and NaN inputs safely', () => {
    expect(formatTimeDetailed(0)).toBe('0:00.000')
    expect(formatTimeDetailed(-1)).toBe('0:00.000')
    expect(formatTimeDetailed(Number.NaN)).toBe('0:00.000')
  })

  it('formats millisecond precision and minute rollover', () => {
    expect(formatTimeDetailed(0.007)).toBe('0:00.007')
    expect(formatTimeDetailed(12.3456)).toBe('0:12.346')
    expect(formatTimeDetailed(59.9996)).toBe('1:00.000')
    expect(formatTimeDetailed(183.042)).toBe('3:03.042')
  })
})

describe('formatSampleRate', () => {
  it('formats standard audio sample rates cleanly', () => {
    expect(formatSampleRate(44100)).toBe('44.1 кГц')
    expect(formatSampleRate(48000)).toBe('48 кГц')
    expect(formatSampleRate(96000)).toBe('96 кГц')
    expect(formatSampleRate(22050)).toBe('22.05 кГц')
    expect(formatSampleRate(192000)).toBe('192 кГц')
  })

  it('handles low and invalid rates safely', () => {
    expect(formatSampleRate(800)).toBe('800 Гц')
    expect(formatSampleRate(0)).toBe('0 Гц')
    expect(formatSampleRate(-48000)).toBe('0 Гц')
    expect(formatSampleRate(Number.NaN)).toBe('0 Гц')
  })
})

describe('defaultExportFileName', () => {
  it('strips single or last extension and appends -seamless.wav', () => {
    expect(defaultExportFileName('ambient-pad.flac')).toBe('ambient-pad-seamless.wav')
    expect(defaultExportFileName('track.v2.final.mp3')).toBe('track.v2.final-seamless.wav')
  })

  it('handles files without extension, leading dot, and empty strings', () => {
    expect(defaultExportFileName('master_loop')).toBe('master_loop-seamless.wav')
    expect(defaultExportFileName('.hidden')).toBe('.hidden-seamless.wav')
    expect(defaultExportFileName('   ')).toBe('loop-seamless.wav')
  })
})
