/**
 * Константы адаптивного оверлея (логические px / DIP).
 * Раньше были разбросаны по overlay-window.ts (36%, 440, margin 10, dock 480/460…);
 * сверяйте с планом DPI/экранов при изменении формул.
 */
export const OVERLAY_EDGE_MARGIN = 8
export const OVERLAY_MAX_HEIGHT_FRAC = 0.85
/** Широкий монитор: потолок ширины окна (ультравайд и т.п.). */
export const OVERLAY_ULTRAWIDE_MIN_WORK_WIDTH = 3000
export const OVERLAY_ULTRAWIDE_MAX_WIDTH = 480

export type OverlayLayoutPreset = 'compact' | 'reading' | 'full'

/** Целевая ширина по пресету UI и ширине workArea (sw). */
export function overlayWidthForPreset(
  preset: OverlayLayoutPreset,
  sw: number,
  ultrawideCap: boolean
): number {
  let w: number
  switch (preset) {
    case 'compact':
      w = Math.min(340, Math.floor(sw * 0.22))
      w = Math.max(280, w)
      break
    case 'reading':
      w = Math.min(560, Math.floor(sw * 0.38))
      w = Math.max(400, w)
      break
    case 'full':
    default:
      w = Math.min(420, Math.floor(sw * 0.28))
      w = Math.max(320, w)
      break
  }
  if (ultrawideCap) w = Math.min(w, OVERLAY_ULTRAWIDE_MAX_WIDTH)
  return w
}

export function overlayWorkAreaIsUltrawide(work: { width: number; height: number }): boolean {
  if (work.width >= OVERLAY_ULTRAWIDE_MIN_WORK_WIDTH) return true
  const ar = work.width / Math.max(1, work.height)
  return ar > 2.25
}
