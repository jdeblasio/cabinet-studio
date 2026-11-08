/**
 * Paper layout for drawing sheets: the sheet size, standard drawing scales, fitting views onto a
 * sheet at one shared scale, and projecting world geometry onto paper.
 *
 * Paper units are points (1/72"); world units are ticks.
 */
import { TICKS_PER_INCH, type Ticks, type UnitSystem } from '@cabinet-studio/engine';

export const PT_PER_IN = 72;

/**
 * Sheet geometry in points. 10.2" × 7.45" fits both Letter and A4 landscape inside the 0.35"
 * page margin, so one sheet prints on one page either way.
 */
export const SHEET = {
  w: 10.2 * PT_PER_IN,
  h: 7.45 * PT_PER_IN,
  /** Page margin around the sheet frame (on screen: white border). */
  margin: 0.15 * PT_PER_IN,
  border: 1.2,
  titleH: 0.62 * PT_PER_IN,
  /** Padding inside the frame around the drawing area. */
  bodyPad: 6,
} as const;

/** The drawing area of a sheet, inside its frame and above the title block. */
export const AREA = {
  w: SHEET.w - 2 * (SHEET.margin + SHEET.border + SHEET.bodyPad),
  h: SHEET.h - 2 * (SHEET.margin + SHEET.border + SHEET.bodyPad) - SHEET.titleH,
} as const;

/** Paper sizes (points) of view furniture: wall/floor poché bands, captions, the section-marker band, gaps between views. */
export const VIEW = { poche: 6, caption: 26, marker: 18, gap: 16 } as const;

export interface Scale {
  /** Paper points per world inch. */
  k: number;
  /** 1:denom, or 0 when the drawing is not to a standard scale. */
  denom: number;
  /** e.g. `3/4" = 1'-0"`, `1:20` or `Not to scale`. */
  label: string;
}

const IMPERIAL: readonly (readonly [number, string])[] = [
  [2, '6" = 1\'-0"'],
  [4, '3" = 1\'-0"'],
  [8, '1 1/2" = 1\'-0"'],
  [12, '1" = 1\'-0"'],
  [16, '3/4" = 1\'-0"'],
  [24, '1/2" = 1\'-0"'],
  [32, '3/8" = 1\'-0"'],
  [48, '1/4" = 1\'-0"'],
  [64, '3/16" = 1\'-0"'],
  [96, '1/8" = 1\'-0"'],
];
const METRIC: readonly number[] = [2, 5, 10, 20, 25, 50, 100];

/** Standard drawing scales for a unit system, largest first. */
export function standardScales(system: UnitSystem): Scale[] {
  if (system === 'metric') return METRIC.map((d) => ({ k: PT_PER_IN / d, denom: d, label: `1:${d}` }));
  return IMPERIAL.map(([d, label]) => ({ k: PT_PER_IN / d, denom: d, label }));
}

export interface Pad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_PAD: Pad = { top: 0, right: 0, bottom: 0, left: 0 };

/** One view to place: its world size, and the paper space it needs around it (dimensions, captions). */
export interface ViewNeed {
  w: Ticks;
  h: Ticks;
  pad: Pad;
}

/** Paper rectangle of a placed view's drawing (pads excluded). */
export interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FitOptions {
  /** 'row': side by side, bottoms aligned (sections share a floor line). 'column': stacked, left edges aligned. */
  dir: 'row' | 'column';
  /** Paper space between views. */
  gap: number;
  system: UnitSystem;
  /** Never use a larger scale than this (keeps a set of sheets at one scale). */
  maxK?: number;
}

/** Paper size of the arranged views at scale k. */
export function arrangedSize(needs: readonly ViewNeed[], k: number, dir: 'row' | 'column', gap: number): { w: number; h: number } {
  const ws = needs.map((n) => (n.w / TICKS_PER_INCH) * k);
  const hs = needs.map((n) => (n.h / TICKS_PER_INCH) * k);
  const gaps = Math.max(0, needs.length - 1) * gap;
  if (dir === 'row') {
    const w = needs.reduce((s, n, i) => s + ws[i]! + n.pad.left + n.pad.right, 0) + gaps;
    const above = Math.max(0, ...needs.map((n, i) => hs[i]! + n.pad.top));
    const below = Math.max(0, ...needs.map((n) => n.pad.bottom));
    return { w, h: above + below };
  }
  const h = needs.reduce((s, n, i) => s + hs[i]! + n.pad.top + n.pad.bottom, 0) + gaps;
  const left = Math.max(0, ...needs.map((n) => n.pad.left));
  const right = Math.max(0, ...needs.map((n, i) => ws[i]! + n.pad.right));
  return { w: left + right, h };
}

const fitsAt = (needs: readonly ViewNeed[], k: number, area: { w: number; h: number }, o: FitOptions) => {
  const s = arrangedSize(needs, k, o.dir, o.gap);
  return s.w <= area.w + 1e-6 && s.h <= area.h + 1e-6;
};

/** Largest scale factor (any value) at which the views fit, by bisection. */
function maxFitK(needs: readonly ViewNeed[], area: { w: number; h: number }, o: FitOptions): number {
  let lo = 0;
  let hi = PT_PER_IN; // full size
  if (fitsAt(needs, hi, area, o)) return hi;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (fitsAt(needs, mid, area, o)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The largest standard scale at which the views fit, or a non-standard fit marked "Not to scale". */
export function chooseScale(needs: readonly ViewNeed[], area: { w: number; h: number }, o: FitOptions): Scale {
  const scales = standardScales(o.system).filter((s) => o.maxK === undefined || s.k <= o.maxK + 1e-9);
  const best = scales.find((s) => fitsAt(needs, s.k, area, o));
  if (best) return best;
  return { k: Math.max(maxFitK(needs, area, o), 1e-3), denom: 0, label: 'Not to scale' };
}

/** Place views in the area at one scale, centered as a group. */
export function fitViews(needs: readonly ViewNeed[], area: { w: number; h: number }, o: FitOptions): { scale: Scale; views: Placed[] } {
  const scale = chooseScale(needs, area, o);
  return { scale, views: placeViews(needs, scale.k, area, o.dir, o.gap) };
}

/** Place views at scale k, centered as a group in the area. */
export function placeViews(needs: readonly ViewNeed[], k: number, area: { w: number; h: number }, dir: 'row' | 'column', gap: number): Placed[] {
  const size = arrangedSize(needs, k, dir, gap);
  const ox = (area.w - size.w) / 2;
  const oy = (area.h - size.h) / 2;
  const out: Placed[] = [];
  if (dir === 'row') {
    const above = Math.max(0, ...needs.map((n) => (n.h / TICKS_PER_INCH) * k + n.pad.top));
    let x = ox;
    for (const n of needs) {
      const w = (n.w / TICKS_PER_INCH) * k;
      const h = (n.h / TICKS_PER_INCH) * k;
      out.push({ x: x + n.pad.left, y: oy + above - h, w, h });
      x += n.pad.left + w + n.pad.right + gap;
    }
  } else {
    const left = Math.max(0, ...needs.map((n) => n.pad.left));
    let y = oy;
    for (const n of needs) {
      const w = (n.w / TICKS_PER_INCH) * k;
      const h = (n.h / TICKS_PER_INCH) * k;
      out.push({ x: ox + left, y: y + n.pad.top, w, h });
      y += n.pad.top + h + n.pad.bottom + gap;
    }
  }
  return out;
}

/**
 * Split views into sheets, side by side, all at one scale: the largest standard scale at which
 * every view fits on its own, with as many views per sheet as fit at that scale.
 */
export function packViews(needs: readonly ViewNeed[], area: { w: number; h: number }, o: Omit<FitOptions, 'dir'>): { scale: Scale; sheets: number[][] } {
  const opts: FitOptions = { ...o, dir: 'row' };
  if (needs.length === 0) return { scale: standardScales(o.system)[0]!, sheets: [] };
  const scale = needs
    .map((n) => chooseScale([n], area, opts))
    .reduce((a, b) => (b.k < a.k ? b : a));
  const sheets: number[][] = [];
  let cur: number[] = [];
  needs.forEach((_, i) => {
    const next = [...cur, i];
    if (cur.length === 0 || fitsAt(next.map((j) => needs[j]!), scale.k, area, opts)) cur = next;
    else {
      sheets.push(cur);
      cur = [i];
    }
  });
  if (cur.length) sheets.push(cur);
  return { scale, sheets };
}

/** Maps a view's world window onto its placed paper rect. */
export interface Proj {
  /** Paper points per world inch. */
  k: number;
  x: (u: Ticks) => number;
  y: (v: Ticks) => number;
  len: (t: Ticks) => number;
}

/**
 * Projection for a placed view. The window is the view's world extent: u across the page, v
 * up the page when `up` (elevations, sections) or down it (plans, where v is z out from the wall).
 */
export function projection(placed: Placed, k: number, win: { u0: Ticks; v0: Ticks; v1: Ticks }, up: boolean): Proj {
  const s = k / TICKS_PER_INCH;
  return {
    k,
    x: (u) => placed.x + (u - win.u0) * s,
    y: up ? (v) => placed.y + (win.v1 - v) * s : (v) => placed.y + (v - win.v0) * s,
    len: (t) => t * s,
  };
}
