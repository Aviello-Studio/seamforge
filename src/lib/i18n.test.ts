import { describe, expect, it } from 'vitest'
import {
  formatBarsLocalized,
  formatChannelLabel,
  formatSampleRateLocalized,
  LOCALES,
  TRANSLATIONS,
  translateAnalysisStage,
  type Locale,
} from './i18n'

const EXPECTED_LOCALES: Locale[] = ['en', 'ru', 'zh', 'ja', 'es', 'de']

describe('i18n translations', () => {
  it('defines all 6 supported locales in LOCALES and TRANSLATIONS', () => {
    expect(LOCALES.map((item) => item.code)).toEqual(EXPECTED_LOCALES)
    expect(Object.keys(TRANSLATIONS).sort()).toEqual([...EXPECTED_LOCALES].sort())
  })

  it('has identical key sets and non-empty strings across all 6 locales', () => {
    const baseKeys = Object.keys(TRANSLATIONS.en).sort()
    expect(baseKeys.length).toBeGreaterThan(0)

    for (const locale of EXPECTED_LOCALES) {
      const map = TRANSLATIONS[locale]
      expect(Object.keys(map).sort()).toEqual(baseKeys)
      for (const key of baseKeys) {
        const value = map[key as keyof typeof map]
        expect(typeof value, `${locale}.${key} should be string`).toBe('string')
        expect(value.trim().length, `${locale}.${key} should be non-empty`).toBeGreaterThan(0)
      }
    }
  })

  it('maps backend Russian stage labels to localized strings', () => {
    expect(translateAnalysisStage('Спектральный анализ (STFT)', TRANSLATIONS.en)).toBe(
      'Spectral analysis (STFT)',
    )
    expect(translateAnalysisStage('Анализ завершён', TRANSLATIONS.ja)).toBe('解析完了')
    expect(translateAnalysisStage('Custom stage', TRANSLATIONS.de)).toBe('Custom stage')
  })
})

describe('formatBarsLocalized', () => {
  it('formats singular and plural forms across all 6 locales', () => {
    expect(formatBarsLocalized(1, 'en')).toBe('1 bar')
    expect(formatBarsLocalized(4, 'en')).toBe('4 bars')

    expect(formatBarsLocalized(1, 'ru')).toBe('1 такт')
    expect(formatBarsLocalized(2, 'ru')).toBe('2 такта')
    expect(formatBarsLocalized(5, 'ru')).toBe('5 тактов')
    expect(formatBarsLocalized(11, 'ru')).toBe('11 тактов')
    expect(formatBarsLocalized(14, 'ru')).toBe('14 тактов')
    expect(formatBarsLocalized(21, 'ru')).toBe('21 такт')
    expect(formatBarsLocalized(22, 'ru')).toBe('22 такта')

    expect(formatBarsLocalized(8, 'zh')).toBe('8 小节')
    expect(formatBarsLocalized(8, 'ja')).toBe('8 小節')

    expect(formatBarsLocalized(1, 'es')).toBe('1 compás')
    expect(formatBarsLocalized(8, 'es')).toBe('8 compases')

    expect(formatBarsLocalized(1, 'de')).toBe('1 Takt')
    expect(formatBarsLocalized(8, 'de')).toBe('8 Takte')
  })
})

describe('formatChannelLabel', () => {
  it('formats mono, stereo, and multi-channel labels across all 6 locales', () => {
    expect(formatChannelLabel(1, 'en')).toBe('Mono')
    expect(formatChannelLabel(2, 'en')).toBe('Stereo')
    expect(formatChannelLabel(6, 'en')).toBe('6 ch')

    expect(formatChannelLabel(1, 'ru')).toBe('Моно')
    expect(formatChannelLabel(2, 'ru')).toBe('Стерео')
    expect(formatChannelLabel(6, 'ru')).toBe('6 кан.')

    expect(formatChannelLabel(1, 'zh')).toBe('单声道')
    expect(formatChannelLabel(2, 'zh')).toBe('立体声')
    expect(formatChannelLabel(6, 'zh')).toBe('6 声道')

    expect(formatChannelLabel(1, 'ja')).toBe('モノラル')
    expect(formatChannelLabel(2, 'ja')).toBe('ステレオ')
    expect(formatChannelLabel(6, 'ja')).toBe('6 ch')

    expect(formatChannelLabel(1, 'es')).toBe('Mono')
    expect(formatChannelLabel(2, 'es')).toBe('Estéreo')
    expect(formatChannelLabel(6, 'es')).toBe('6 can.')

    expect(formatChannelLabel(1, 'de')).toBe('Mono')
    expect(formatChannelLabel(2, 'de')).toBe('Stereo')
    expect(formatChannelLabel(6, 'de')).toBe('6 Kan.')
  })
})

describe('formatSampleRateLocalized', () => {
  it('uses кГц/Гц for Russian and kHz/Hz for other locales', () => {
    expect(formatSampleRateLocalized(44100, 'ru')).toBe('44.1 кГц')
    expect(formatSampleRateLocalized(48000, 'ru')).toBe('48 кГц')
    expect(formatSampleRateLocalized(800, 'ru')).toBe('800 Гц')

    for (const locale of ['en', 'zh', 'ja', 'es', 'de'] as const) {
      expect(formatSampleRateLocalized(44100, locale)).toBe('44.1 kHz')
      expect(formatSampleRateLocalized(48000, locale)).toBe('48 kHz')
      expect(formatSampleRateLocalized(800, locale)).toBe('800 Hz')
    }
  })
})
