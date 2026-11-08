import { inches } from '@cabinet-studio/engine';
import { describe, expect, it } from 'vitest';
import { AREA, NO_PAD, SHEET, chooseScale, packViews, placeViews, projection, standardScales, type ViewNeed } from './scale';

const need = (w: number, h: number, pad = NO_PAD): ViewNeed => ({ w: inches(w), h: inches(h), pad });
const AREA_700x450 = { w: 700, h: 450 };

describe('sheet geometry', () => {
  it('fits Letter and A4 landscape inside 0.35" print margins', () => {
    const printable = { w: Math.min(11, 297 / 25.4) - 0.7, h: Math.min(8.5, 210 / 25.4) - 0.7 };
    expect(SHEET.w / 72).toBeLessThanOrEqual(printable.w);
    expect(SHEET.h / 72).toBeLessThanOrEqual(printable.h);
    expect(AREA.w).toBeGreaterThan(0);
    expect(AREA.h).toBeGreaterThan(0);
  });
});

describe('standard scales', () => {
  it('lists architectural scales largest first', () => {
    const s = standardScales('imperial');
    expect(s.map((x) => x.denom)).toEqual([...s.map((x) => x.denom)].sort((a, b) => a - b));
    expect(s.find((x) => x.denom === 16)).toEqual({ k: 4.5, denom: 16, label: '3/4" = 1\'-0"' });
    expect(standardScales('metric').map((x) => x.label)).toContain('1:20');
  });
});

describe('chooseScale', () => {
  const o = { dir: 'row' as const, gap: 0, system: 'imperial' as const };

  it('picks the largest standard scale that fits', () => {
    // 96" tall in 450 pt → k ≤ 4.69 → 3/4" = 1'-0" (k 4.5).
    expect(chooseScale([need(120, 96)], AREA_700x450, o).denom).toBe(16);
  });

  it('counts paper pads, which do not scale', () => {
    // 96k + 60 ≤ 450 → k ≤ 4.06 → 1/2" = 1'-0".
    expect(chooseScale([need(120, 96, { top: 30, bottom: 30, left: 0, right: 0 })], AREA_700x450, o).denom).toBe(24);
  });

  it('respects a maximum scale', () => {
    expect(chooseScale([need(10, 10)], AREA_700x450, { ...o, maxK: 3 }).denom).toBe(24);
  });

  it('falls back to a fitted, non-standard scale', () => {
    const s = chooseScale([need(2000, 96)], AREA_700x450, o);
    expect(s.denom).toBe(0);
    expect(s.label).toBe('Not to scale');
    expect(2000 * s.k).toBeLessThanOrEqual(700 + 1e-6);
    expect(2000 * s.k).toBeGreaterThan(690);
  });
});

describe('placeViews', () => {
  it('aligns bottoms of views side by side and centers the group', () => {
    const k = 3;
    const [a, b] = placeViews([need(20, 96), need(30, 40)], k, AREA_700x450, 'row', 10);
    expect(a!.y + a!.h).toBeCloseTo(b!.y + b!.h);
    expect(b!.x).toBeCloseTo(a!.x + a!.w + 10);
    const total = 20 * k + 10 + 30 * k;
    expect(a!.x).toBeCloseTo((700 - total) / 2);
  });

  it('aligns left edges of stacked views, leaving each its pads', () => {
    const pad = { top: 12, bottom: 20, left: 15, right: 0 };
    const [a, b] = placeViews([need(100, 10, pad), need(100, 20, { ...pad, left: 30 })], 2, AREA_700x450, 'column', 8);
    expect(a!.x).toBe(b!.x);
    expect(b!.y).toBeCloseTo(a!.y + a!.h + pad.bottom + 8 + pad.top);
  });
});

describe('packViews', () => {
  it('puts as many views on a sheet as fit at the shared scale', () => {
    // Each 40 × 96 at 1:16 is 180 pt wide; three fit in 700 pt with gaps, four don't.
    const needs = [0, 1, 2, 3, 4].map(() => need(40, 96));
    const { scale, sheets } = packViews(needs, AREA_700x450, { gap: 10, system: 'imperial' });
    expect(scale.denom).toBe(16);
    expect(sheets).toEqual([[0, 1, 2], [3, 4]]);
  });

  it('handles no views', () => {
    expect(packViews([], AREA_700x450, { gap: 10, system: 'metric' }).sheets).toEqual([]);
  });
});

describe('projection', () => {
  const placed = { x: 10, y: 20, w: 100, h: 50 };
  it('flips v for views where up is up', () => {
    const p = projection(placed, 2, { u0: 0, v0: 0, v1: inches(25) }, true);
    expect(p.x(inches(5))).toBe(20);
    expect(p.y(inches(25))).toBe(20);
    expect(p.y(0)).toBe(70);
    expect(p.len(inches(3))).toBe(6);
  });
  it('keeps v pointing down the page for plans', () => {
    const p = projection(placed, 2, { u0: 0, v0: 0, v1: inches(25) }, false);
    expect(p.y(0)).toBe(20);
    expect(p.y(inches(10))).toBe(40);
  });
});
