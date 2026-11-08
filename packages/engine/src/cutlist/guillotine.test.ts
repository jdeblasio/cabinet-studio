import { describe, expect, it } from 'vitest';
import { inches } from '../units';
import { nestGuillotine, usableRect, type CutTree, type NestItem, type NestRect, type NestResult, type NestSheetSpec } from './guillotine';
import { inside, isGuillotine, kerfSeparated, rng } from './testing';

const K = inches(1 / 8);
const noTrim = { left: 0, right: 0, top: 0, bottom: 0 };
const spec = (o: Partial<NestSheetSpec> = {}): NestSheetSpec => ({ length: inches(96), width: inches(48), kerf: K, trim: noTrim, ...o });
const item = (w: number, h: number, canRotate = false): NestItem => ({ w: inches(w), h: inches(h), canRotate });

/** Every structural property a guillotine layout must have. */
function expectValid(res: NestResult, items: readonly NestItem[], s: NestSheetSpec): void {
  const area = usableRect(s)!;
  const seen = new Set<number>();
  for (const sheet of res.sheets) {
    const rects = sheet.placements;
    for (const p of rects) {
      expect(inside(p, area), 'inside the trimmed sheet').toBe(true);
      const it = items[p.item]!;
      expect(seen.has(p.item), 'placed once').toBe(false);
      seen.add(p.item);
      if (p.rotated) {
        expect(it.canRotate, 'rotated only when allowed').toBe(true);
        expect([p.w, p.h]).toEqual([it.h, it.w]);
      } else {
        expect([p.w, p.h]).toEqual([it.w, it.h]);
      }
    }
    expect(kerfSeparated(rects, s.kerf), 'no overlaps, kerf between parts').toBe(true);
    expect(isGuillotine(rects, area, s.kerf), 'decomposes by edge-to-edge cuts').toBe(true);
    // Cuts never pass through a part, and each runs edge to edge of a piece of the tree.
    for (const c of sheet.cuts) {
      for (const p of rects) {
        const crosses = c.direction === 'rip' ? c.y1 > p.y && c.y1 < p.y + p.h && c.x1 < p.x + p.w && c.x2 > p.x : c.x1 > p.x && c.x1 < p.x + p.w && c.y1 < p.y + p.h && c.y2 > p.y;
        expect(crosses, `cut ${c.step} crosses a part`).toBe(false);
        const k = c.kerf;
        const kerfHits = k.x < p.x + p.w && p.x < k.x + k.w && k.y < p.y + p.h && p.y < k.y + k.h;
        expect(kerfHits, `kerf of cut ${c.step} eats into a part`).toBe(false);
      }
    }
    // Stages never decrease along the sequence.
    for (let i = 1; i < sheet.cuts.length; i++) expect(sheet.cuts[i]!.stage).toBeGreaterThanOrEqual(sheet.cuts[i - 1]!.stage);
    // Offcuts don't overlap parts.
    for (const o of sheet.offcuts) for (const p of rects) expect(kerfSeparated([o, p], 0)).toBe(true);
  }
  for (const u of res.unplaced) {
    expect(seen.has(u)).toBe(false);
    seen.add(u);
  }
  expect(seen.size, 'every item placed or reported').toBe(items.length);
}

/** Every cut tree node's children lie inside it, separated by the kerf. */
function expectTree(t: CutTree, kerf: number): void {
  if (t.kind !== 'cut') return;
  const r = t.rect;
  const a: NestRect = t.a.rect;
  expect([a.x, a.y]).toEqual([r.x, r.y]);
  if (t.axis === 'x') expect(a.x + a.w).toBe(t.at);
  else expect(a.y + a.h).toBe(t.at);
  if (t.b) {
    const b = t.b.rect;
    if (t.axis === 'x') expect([b.x, b.x + b.w, b.h]).toEqual([t.at + kerf, r.x + r.w, r.h]);
    else expect([b.y, b.y + b.h, b.w]).toEqual([t.at + kerf, r.y + r.h, r.w]);
    expectTree(t.b, kerf);
  }
  expectTree(t.a, kerf);
}

describe('nestGuillotine: basics', () => {
  it('places one part at the corner of the trimmed sheet', () => {
    const s = spec({ trim: { left: inches(0.25), right: inches(0.25), top: inches(0.5), bottom: inches(0.5) } });
    const res = nestGuillotine([item(30, 20)], s);
    expect(res.sheets).toHaveLength(1);
    const p = res.sheets[0]!.placements[0]!;
    expect(p).toMatchObject({ x: inches(0.25), y: inches(0.5), w: inches(30), h: inches(20), rotated: false });
    expectValid(res, [item(30, 20)], s);
  });

  it('lists trims first, then cuts stage by stage', () => {
    const s = spec({ trim: { left: inches(0.25), right: inches(0.25), top: inches(0.25), bottom: inches(0.25) } });
    const res = nestGuillotine([item(30, 20)], s);
    const cuts = res.sheets[0]!.cuts;
    expect(cuts.slice(0, 4).map((c) => [c.stage, c.direction])).toEqual([
      [0, 'rip'],
      [0, 'rip'],
      [0, 'cross'],
      [0, 'cross'],
    ]);
    expect(cuts.slice(4).map((c) => c.stage)).toEqual([1, 2]);
    expect(cuts.map((c) => c.step)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('needs no cuts for a part that fills the sheet', () => {
    const res = nestGuillotine([item(96, 48)], spec());
    expect(res.sheets[0]!.cuts).toEqual([]);
    expect(res.sheets[0]!.offcuts).toEqual([]);
  });

  it('fits parts edge to edge only with a kerf between them', () => {
    // Two 47 15/16" pieces need 95 7/8" + kerf = 96": exactly one sheet length.
    const two = [item(47 + 15 / 16, 48), item(47 + 15 / 16, 48)];
    expect(nestGuillotine(two, spec()).sheets).toHaveLength(1);
    // 1/32" more and the kerf no longer fits.
    const tooBig = [item(47 + 31 / 32, 48), item(47 + 31 / 32, 48)];
    expect(nestGuillotine(tooBig, spec()).sheets).toHaveLength(2);
    // Without kerf they fit again.
    expect(nestGuillotine(tooBig, spec({ kerf: 0 })).sheets).toHaveLength(1);
  });

  it('honors trim on every edge', () => {
    const s = spec({ trim: { left: inches(1), right: inches(1), top: inches(1), bottom: inches(1) } });
    expect(nestGuillotine([item(94, 46)], s).unplaced).toEqual([]);
    expect(nestGuillotine([item(94 + 1 / 32, 46)], s).unplaced).toEqual([0]);
    expect(nestGuillotine([item(94, 46 + 1 / 32)], s).unplaced).toEqual([0]);
  });

  it('keeps grain-locked parts along the sheet length, rotates free ones', () => {
    // 40" × 90": only fits turned across the sheet.
    expect(nestGuillotine([item(40, 90)], spec()).unplaced).toEqual([0]);
    const res = nestGuillotine([item(40, 90, true)], spec());
    expect(res.unplaced).toEqual([]);
    expect(res.sheets[0]!.placements[0]).toMatchObject({ rotated: true, w: inches(90), h: inches(40) });
  });

  it('reports parts larger than the sheet instead of dropping them', () => {
    const items = [item(144 + 9 / 16, 15 + 9 / 32), item(30, 15), item(144 + 9 / 16, 15 + 9 / 32)];
    const res = nestGuillotine(items, spec());
    expect(res.unplaced).toEqual([0, 2]);
    expect(res.sheets).toHaveLength(1);
    expectValid(res, items, spec());
  });

  it('reports everything when the trim leaves no room, and handles no items', () => {
    const s = spec({ trim: { left: inches(48), right: inches(48), top: 0, bottom: 0 } });
    expect(nestGuillotine([item(1, 1)], s)).toMatchObject({ sheets: [], unplaced: [0] });
    expect(nestGuillotine([], spec())).toMatchObject({ sheets: [], unplaced: [] });
  });

  it('packs identical parts tightly', () => {
    // 8 parts of 23 7/8" × 23 7/8" fill one 96" × 48" sheet with kerf: 4 × 23 7/8 + 3/8 = 95 7/8.
    const items = Array.from({ length: 8 }, () => item(23 + 7 / 8, 23 + 15 / 16));
    const res = nestGuillotine(items, spec());
    expect(res.sheets).toHaveLength(1);
    expectValid(res, items, spec());
    // One more needs a second sheet.
    expect(nestGuillotine([...items, item(23 + 7 / 8, 23 + 15 / 16)], spec()).sheets).toHaveLength(2);
  });

  it('drops cuts that would only separate waste from waste', () => {
    const res = nestGuillotine([item(30, 20)], spec());
    const sheet = res.sheets[0]!;
    // One part in a corner needs exactly two cuts; the leftover is two offcuts.
    expect(sheet.cuts).toHaveLength(2);
    expect(sheet.offcuts).toHaveLength(2);
    expectTree(sheet.tree, K);
  });

  it('puts the fullest sheet first and reports part area', () => {
    const items = [item(70, 40), item(20, 20)];
    const res = nestGuillotine(items, spec());
    expect(res.sheets).toHaveLength(1);
    expect(res.sheets[0]!.partArea).toBe(inches(70) * inches(40) + inches(20) * inches(20));
    const many = [item(90, 46), item(90, 46), item(10, 10)];
    const r2 = nestGuillotine(many, spec());
    const areas = r2.sheets.map((s) => s.partArea);
    expect([...areas].sort((a, b) => b - a)).toEqual(areas);
  });
});

describe('nestGuillotine: properties', () => {
  const cases: { name: string; seed: number; n: number; rotate: boolean; trim: number; kerf: number }[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    cases.push({ name: `seed ${seed}`, seed, n: 5 + ((seed * 7) % 40), rotate: seed % 2 === 0, trim: seed % 3 === 0 ? 0 : 1 / 4, kerf: seed % 5 === 0 ? 0 : 1 / 8 });
  }
  const families = [
    ['free-rectangle', /^(?!strips)/],
    ['strips along', /^strips-along/],
    ['strips across', /^strips-across/],
    ['best of all', undefined],
  ] as const;
  it.each(cases.flatMap((c) => families.map(([family, only]) => ({ ...c, family, only }))))('random layout is a valid guillotine layout ($name, $family)', ({ seed, n, rotate, trim, kerf, only }) => {
    const r = rng(seed);
    const items: NestItem[] = Array.from({ length: n }, () => {
      // Snap to 1/32" like derived parts; mostly cabinet-like sizes, a few oversize.
      const w = Math.round((4 + r() * (r() < 0.05 ? 120 : 70)) * 32) / 32;
      const h = Math.round((2 + r() * (r() < 0.05 ? 60 : 30)) * 32) / 32;
      return item(w, h, rotate);
    });
    const t = inches(trim);
    const s = spec({ kerf: inches(kerf), trim: { left: t, right: t, top: t, bottom: t } });
    const res = nestGuillotine(items, s, only);
    if (only) expect(only.test(res.strategy)).toBe(true);
    expectValid(res, items, s);
    for (const sheet of res.sheets) expectTree(sheet.tree, s.kerf);
    // Never more sheets than parts, and at least the area bound.
    const placedArea = res.sheets.reduce((a, sh) => a + sh.partArea, 0);
    const area = usableRect(s)!;
    expect(res.sheets.length).toBeGreaterThanOrEqual(Math.ceil(placedArea / (area.w * area.h) - 1e-9));
    expect(res.sheets.length).toBeLessThanOrEqual(items.length - res.unplaced.length);
  });

  it('is deterministic', () => {
    const r = rng(99);
    const items = Array.from({ length: 60 }, () => item(Math.round((5 + r() * 60) * 32) / 32, Math.round((3 + r() * 25) * 32) / 32, r() < 0.5));
    const a = nestGuillotine(items, spec());
    const b = nestGuillotine(items.map((i) => ({ ...i })), spec());
    expect(b).toEqual(a);
  });

  it('mixes sizes within a strip when that saves sheets', () => {
    // 20 × 30" and 20 × 34 1/2" parts, all 23 1/4" wide: two strips per sheet, and a 96" strip
    // holds 34 1/2 + 30 + 30 at best. 10 such strips plus 5 of 34 1/2 + 34 1/2 = 15 strips → 8 sheets.
    // Largest-first greedy needs 9 (four 34 1/2" parts per sheet, then the 30" parts).
    const items = [...Array.from({ length: 20 }, () => item(30, 23.25)), ...Array.from({ length: 20 }, () => item(34.5, 23.25))];
    const res = nestGuillotine(items, spec());
    expect(res.sheets).toHaveLength(8);
    expect(res.strategy).toMatch(/^strips/);
    expectValid(res, items, spec());
  });

  it('reaches the area bound on a classic carcass set', () => {
    // 23 7/8" × 11 27/32": exactly 16 per sheet (4 along, 4 across, with kerf).
    const items = Array.from({ length: 16 }, () => item(23 + 7 / 8, 11 + 27 / 32));
    expect(nestGuillotine(items, spec()).sheets).toHaveLength(1);
    const more = Array.from({ length: 17 }, () => item(23 + 7 / 8, 11 + 27 / 32));
    expect(nestGuillotine(more, spec()).sheets).toHaveLength(2);
  });
});
