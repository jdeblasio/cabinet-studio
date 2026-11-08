/**
 * Lengths are stored as integer "ticks" of 1/8128 inch (= 3.125 µm).
 * This unit represents both imperial and metric grids exactly:
 *   1/64" = 127 ticks, 1/32" = 254 ticks, 1" = 8128 ticks
 *   0.1 mm = 32 ticks, 0.5 mm = 160 ticks, 1 mm = 320 ticks
 */
export type Ticks = number;

export const TICKS_PER_INCH = 8128;
export const TICKS_PER_MM = 320;

export type UnitSystem = 'imperial' | 'metric';

export const inches = (n: number): Ticks => Math.round(n * TICKS_PER_INCH);
export const mm = (n: number): Ticks => Math.round(n * TICKS_PER_MM);
export const toInches = (t: Ticks): number => t / TICKS_PER_INCH;
export const toMm = (t: Ticks): number => t / TICKS_PER_MM;

/** Default snap grid per unit system: 1/32" or 0.5 mm. */
export const DEFAULT_GRID: Record<UnitSystem, Ticks> = {
  imperial: inches(1 / 32),
  metric: mm(0.5),
};

export type SnapMode = 'nearest' | 'down' | 'up';

/** Snap a length to a multiple of `grid`. */
export function snap(t: Ticks, grid: Ticks, mode: SnapMode = 'nearest'): Ticks {
  if (grid <= 0) return Math.round(t);
  const q = t / grid;
  const n = mode === 'down' ? Math.floor(q + 1e-9) : mode === 'up' ? Math.ceil(q - 1e-9) : Math.round(q);
  return n * grid;
}

export const isOnGrid = (t: Ticks, grid: Ticks): boolean => grid <= 0 || t % grid === 0;
