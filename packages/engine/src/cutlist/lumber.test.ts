import { describe, expect, it } from 'vitest';
import type { Project } from '../model';
import { inches } from '../units';
import { buildCutList } from './cutlist';
import { packLengths, planLumber } from './lumber';
import { DEFAULT_CUTLIST_OPTIONS, resolveCutListOptions, type LumberOptions } from './options';
import { fakePart, fakeResult, projectWith, rng } from './testing';

const K = inches(1 / 8);
const opts = (o: Partial<LumberOptions> = {}): LumberOptions => ({ ...DEFAULT_CUTLIST_OPTIONS.lumber, ...o });
const ins = (xs: number[]) => xs.map(inches);
const span = (lens: number[], kerf: number) => lens.reduce((s, l) => s + l, 0) + Math.max(0, lens.length - 1) * kerf;

/** Every piece is on exactly one board or reported, and no board is over-full. */
function expectValidPacking(lengths: number[], o: LumberOptions, res: ReturnType<typeof packLengths>) {
  const seen = new Set<number>();
  for (const b of res.boards) {
    expect(o.stockLengths).toContain(b.stock);
    expect(span(b.items.map((i) => lengths[i]!), o.kerf)).toBeLessThanOrEqual(b.stock - 2 * o.endTrim);
    for (const i of b.items) {
      expect(seen.has(i)).toBe(false);
      seen.add(i);
    }
  }
  for (const i of res.tooLong) {
    expect(seen.has(i)).toBe(false);
    seen.add(i);
  }
  expect(seen.size).toBe(lengths.length);
}

describe('packLengths', () => {
  it('honors kerf and end trim', () => {
    // 96" board, 1/2" trimmed off each end → 95" usable. Two 47 7/16" pieces + kerf = 95".
    const o = opts({ stockLengths: ins([96]) });
    expect(packLengths(ins([47 + 7 / 16, 47 + 7 / 16]), o).boards).toHaveLength(1);
    expect(packLengths(ins([47 + 15 / 32, 47 + 7 / 16]), o).boards).toHaveLength(2);
    expect(packLengths(ins([47 + 15 / 32, 47 + 7 / 16]), { ...o, kerf: 0 }).boards).toHaveLength(1);
    expect(packLengths(ins([95]), o).tooLong).toEqual([]);
    expect(packLengths(ins([95 + 1 / 32]), o).tooLong).toEqual([0]);
  });

  it('picks the cheapest mix of stock lengths', () => {
    // 4 × 28 5/16": one 120" board (4 fit in 119") beats two 96" boards (3 fit in 95").
    const res = packLengths(ins([28.3125, 28.3125, 28.3125, 28.3125]), opts());
    expect(res.boards.map((b) => b.stock)).toEqual(ins([120]));
    // A single short piece goes on the shortest board.
    expect(packLengths(ins([20]), opts()).boards.map((b) => b.stock)).toEqual(ins([96]));
    // 90" + 30": a 144" board holds both (120 1/8" used) rather than 96" + 96".
    expect(packLengths(ins([90, 30]), opts()).boards.map((b) => b.stock)).toEqual(ins([144]));
  });

  it('reports pieces longer than every board and packs the rest', () => {
    const res = packLengths(ins([144 + 9 / 16, 30, 150]), opts());
    expect(res.tooLong).toEqual([0, 2]);
    expect(res.boards).toHaveLength(1);
    expect(packLengths(ins([30]), opts({ stockLengths: [] }))).toEqual({ boards: [], tooLong: [0] });
  });

  it('finds fills that first fit and best fit decreasing miss', () => {
    // 95" usable, no kerf: first/best fit decreasing need three boards; 49 + 36 + 10 and
    // 52 + 17 + 15 + 10 need two.
    const o = opts({ stockLengths: ins([96]), kerf: 0 });
    const lengths = ins([10, 49, 52, 10, 15, 36, 17]);
    const res = packLengths(lengths, o);
    expect(res.boards).toHaveLength(2);
    expectValidPacking(lengths, o, res);
  });

  it.each(Array.from({ length: 20 }, (_, i) => i + 1))('random packings are valid (seed %i)', (seed) => {
    const r = rng(seed);
    const lengths = Array.from({ length: 3 + Math.floor(r() * 60) }, () => inches(Math.round((6 + r() * (r() < 0.05 ? 160 : 90)) * 32) / 32));
    const o = opts({ kerf: seed % 4 === 0 ? 0 : K, endTrim: seed % 3 === 0 ? 0 : inches(0.5), stockLengths: seed % 2 ? ins([96, 120, 144]) : ins([72, 96]) });
    const res = packLengths(lengths, o);
    expectValidPacking(lengths, o, res);
    // Not worse than one board per piece, and at least the length bound.
    const longest = Math.max(...o.stockLengths);
    const placed = res.boards.flatMap((b) => b.items.map((i) => lengths[i]!));
    expect(res.boards.length).toBeLessThanOrEqual(placed.length);
    expect(res.boards.reduce((s, b) => s + b.stock, 0)).toBeGreaterThanOrEqual(placed.reduce((s, l) => s + l, 0));
    expect(res.boards.length).toBeGreaterThanOrEqual(Math.ceil(placed.reduce((s, l) => s + l, 0) / longest - 1e-9));
  });

  it('is deterministic', () => {
    const r = rng(7);
    const lengths = Array.from({ length: 80 }, () => inches(Math.round((6 + r() * 80) * 8) / 8));
    expect(packLengths(lengths, opts())).toEqual(packLengths([...lengths], opts()));
  });
});

describe('planLumber', () => {
  const poplar = (o: Parameters<typeof fakePart>[0]) => fakePart({ materialId: 'poplar-3-4', thickness: 0.75, role: 'stile', ...o });
  const plan = (project: Project, parts: ReturnType<typeof fakePart>[], o = DEFAULT_CUTLIST_OPTIONS) => {
    const cl = buildCutList(project, [fakeResult(parts)], o);
    return planLumber(cl.lumber, project.materials, o.lumber, project.units.grid);
  };

  it('groups by material, thickness and rip width', () => {
    const p = projectWith();
    const res = plan(p, [poplar({ length: 30, width: 1.5 }), poplar({ length: 30, width: 1.5 }), poplar({ length: 30, width: 2.5 }), poplar({ length: 30, width: 1.5, thickness: 1 })]);
    expect(res.plans.map((pl) => [pl.thickness, pl.width, pl.pieces])).toEqual([
      [inches(1), inches(1.5), 1],
      [inches(0.75), inches(2.5), 1],
      [inches(0.75), inches(1.5), 2],
    ]);
  });

  it('lays cuts out along the board with trim and kerf, and counts board feet', () => {
    const p = projectWith();
    const res = plan(p, [poplar({ length: 40, width: 1.5 }), poplar({ length: 30, width: 1.5 })]);
    const pl = res.plans[0]!;
    expect(pl.stock).toEqual([{ length: inches(96), count: 1 }]);
    const b = pl.boards[0]!;
    expect(b.cuts.map((c) => [c.offset, c.piece.length])).toEqual([
      [inches(0.5), inches(40)],
      [inches(40.5) + K, inches(30)],
    ]);
    expect(b.used).toBe(inches(70));
    expect(b.waste).toBe(inches(26));
    expect(b.offcut).toBe(inches(96 - 0.5 - 70.5) - 2 * K);
    // 3/4 × 1 1/2 × 96 / 144 = 0.75 board feet.
    expect(pl.boardFeet).toBeCloseTo(0.75, 10);
    expect(pl.utilization).toBeCloseTo(70 / 96, 10);
  });

  it('turns parts wider than a board into glue-ups of strips', () => {
    const p = projectWith();
    const top = fakePart({ materialId: 'hardwood-top', thickness: 1.5, role: 'countertop', name: 'Countertop', length: 100, width: 25, ownerId: 'tier-1' });
    const res = plan(p, [top]);
    // 25" + 1/2" allowance over 11 1/4" boards → 3 strips of 8 1/2", each 100 1/2" long.
    expect(res.glueUps).toHaveLength(1);
    expect(res.glueUps[0]).toMatchObject({ boards: 3, boardWidth: inches(8.5), boardLength: inches(100.5), width: inches(25) });
    expect(res.plans).toHaveLength(1);
    expect(res.plans[0]).toMatchObject({ width: inches(8.5), pieces: 3 });
    expect(res.plans[0]!.boards.flatMap((b) => b.cuts.map((c) => c.piece.strip))).toEqual([
      { index: 1, of: 3 },
      { index: 2, of: 3 },
      { index: 3, of: 3 },
    ]);
    // Wider boards allowed → no glue-up.
    const wide = resolveCutListOptions({ lumber: { maxBoardWidth: inches(30) } });
    expect(plan(p, [top], wide).glueUps).toEqual([]);
  });

  it('reports lumber longer than any stock', () => {
    const p = projectWith();
    const res = plan(p, [poplar({ length: 144 + 9 / 16, width: 1.5, name: 'Top rail' }), poplar({ length: 20, width: 1.5 })]);
    expect(res.plans[0]!.tooLong.map((t) => t.part.name)).toEqual(['Top rail']);
    expect(res.plans[0]!.boards).toHaveLength(1);
  });
});
