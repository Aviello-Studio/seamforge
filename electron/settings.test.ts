import { describe, expect, it } from 'vitest'
import { normalizeSettings } from './settings.js'

describe('desktop settings', () => {
  it('accepts only supported processing devices', () => {
    expect(normalizeSettings({ processingDevice: 'cuda' }).processingDevice).toBe('cuda')
    expect(normalizeSettings({ processingDevice: 'directml' }).processingDevice).toBe('cpu')
    expect(normalizeSettings(null).processingDevice).toBe('cpu')
  })
})
