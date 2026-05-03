import { describe, expect, it } from 'vitest'
import {
  OVERLAY_ULTRAWIDE_MIN_WORK_WIDTH,
  overlayWidthForPreset,
  overlayWorkAreaIsUltrawide
} from './overlay-layout-constants'

describe('overlayWidthForPreset', () => {
  it('для compact ограничивает ширину workArea', () => {
    const w = overlayWidthForPreset('compact', 1920, false)
    expect(w).toBeGreaterThanOrEqual(280)
    expect(w).toBeLessThanOrEqual(340)
  })

  it('для ultrawideCap снижает потолок ширины', () => {
    const wWide = overlayWidthForPreset('reading', 4000, true)
    const wNoCap = overlayWidthForPreset('reading', 4000, false)
    expect(wWide).toBeLessThanOrEqual(wNoCap)
  })
})

describe('overlayWorkAreaIsUltrawide', () => {
  it('возвращает true при очень широкой workArea', () => {
    expect(overlayWorkAreaIsUltrawide({ width: OVERLAY_ULTRAWIDE_MIN_WORK_WIDTH, height: 1080 })).toBe(true)
  })

  it('возвращает true при большом соотношении сторон', () => {
    expect(overlayWorkAreaIsUltrawide({ width: 2600, height: 1000 })).toBe(true)
  })

  it('возвращает false для обычного монитора', () => {
    expect(overlayWorkAreaIsUltrawide({ width: 1920, height: 1080 })).toBe(false)
  })
})
