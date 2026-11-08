import { describe, expect, it } from 'vitest';
import { createDefaultProject, DEFAULT_COUNTERTOP, flexBox, opening } from '../defaults';
import { deriveProject } from '../derive/index';
import type { Project } from '../model';
import { inches } from '../units';
import { buildCutReport, resolveCutListOptions } from './index';

/** One wide base box, like a 146" window seat: its top and bottom are ~144 9/16" long. */
function wideBoxProject(): Project {
  const p = createDefaultProject();
  const run = p.runs[0]!;
  run.wall[0]!.length = inches(147);
  const base = run.tiers[0]!;
  base.items = [{ kind: 'box', id: 'wide', width: { kind: 'fixed', size: inches(146) }, content: opening({ type: 'none' }) }];
  run.tiers = [base];
  return p;
}

describe('buildCutReport', () => {
  it('nests every sheet part of the default project or reports it', () => {
    const p = createDefaultProject();
    const results = deriveProject(p);
    const r = buildCutReport(p, results);
    for (const g of r.cutList.sheetGoods) {
      const nest = r.sheets.find((s) => s.materialId === g.materialId)!;
      const placed = nest.sheets.flatMap((s) => s.placements.map((pl) => pl.part.key));
      const unplaced = nest.unplaced.map((u) => u.part.key);
      expect(new Set([...placed, ...unplaced]).size).toBe(g.parts);
      expect(placed.length + unplaced.length).toBe(g.parts);
    }
    // Lumber pieces all end up on a board.
    const pieces = r.lumber.reduce((n, l) => n + l.boards.reduce((m, b) => m + b.cuts.length, 0) + l.tooLong.length, 0);
    expect(pieces).toBe(r.cutList.lumber.reduce((n, g) => n + g.parts, 0));
    expect(r.shopping.sheets.map((s) => s.count)).toEqual(r.sheets.map((s) => s.sheets.length));
  });

  it('reports parts longer than a sheet or a board as not fitting', () => {
    const p = wideBoxProject();
    const r = buildCutReport(p, deriveProject(p));
    const ply = r.sheets.find((s) => s.materialId === 'ply-23-32')!;
    const tooLong = ply.unplaced.filter((u) => u.part.role === 'top' || u.part.role === 'bottom');
    expect(tooLong).toHaveLength(2);
    expect(tooLong[0]!.part.length).toBe(inches(144 + 9 / 16));
    expect(tooLong.every((u) => u.reason === 'too-long' && !u.fitsAcrossGrain)).toBe(true);
    const sheetIssue = r.issues.find((i) => i.code === 'part-exceeds-sheet' && i.message.includes('Top'))!;
    expect(sheetIssue.severity).toBe('error');
    expect(sheetIssue.message).toContain('144 9/16"');
    expect(sheetIssue.sourceId).toBe('wide');
    expect(sheetIssue.runId).toBe(p.runs[0]!.id);
    // The rails are 144 9/16" too: longer than usable 144" stock.
    const rails = r.lumber.flatMap((l) => l.tooLong).filter((t) => t.part.role === 'rail');
    expect(rails).toHaveLength(2);
    expect(r.issues.some((i) => i.code === 'part-exceeds-stock')).toBe(true);
    expect(r.shopping.unplacedParts).toBeGreaterThanOrEqual(4);
    // Errors sort first.
    const sev = r.issues.map((i) => i.severity);
    expect([...sev].sort((a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b))).toEqual(sev);
  });

  it('plans countertop glue-ups and flags countertop thickness that differs from its material', () => {
    const p = createDefaultProject();
    const base = p.runs[0]!.tiers[0]!;
    base.countertop = { ...DEFAULT_COUNTERTOP, thickness: inches(1.25) };
    const r = buildCutReport(p, deriveProject(p));
    expect(r.glueUps).toHaveLength(1);
    expect(r.glueUps[0]).toMatchObject({ thickness: inches(1.25), boards: 2 });
    const mismatch = r.issues.find((i) => i.code === 'thickness-mismatch')!;
    expect(mismatch.severity).toBe('warning');
    expect(mismatch.message).toContain('1 1/4"');
    expect(r.issues.some((i) => i.code === 'glue-up')).toBe(true);
    expect(r.shopping.lumber.some((l) => l.thickness === inches(1.25) && l.width === r.glueUps[0]!.boardWidth)).toBe(true);
  });

  it('buys moldings by length instead of packing them onto boards', () => {
    const p = createDefaultProject();
    p.materials = [...p.materials, { id: 'crown', name: 'Molding (bought by length)', kind: 'lumber', thickness: inches(0.75), color: '#eee' }];
    const results = deriveProject(p);
    const run = results[0]!;
    const crown = (id: string, length: number) => ({ ...run.parts[0]!, id, name: 'Crown molding', role: 'molding' as const, materialId: 'crown', length: inches(length), width: inches(4.5), thickness: inches(3) });
    const withMolding = [{ ...run, parts: [...run.parts, crown('c1', 121), crown('c2', 121), crown('c3', 16)] }];
    const r = buildCutReport(p, withMolding);
    expect(r.lumber.some((l) => l.materialId === 'crown')).toBe(false);
    expect(r.issues.some((i) => i.code === 'thickness-mismatch' || i.code === 'part-exceeds-stock')).toBe(false);
    expect(r.shopping.byLength).toEqual([{ materialId: 'crown', name: 'Molding (bought by length)', width: inches(4.5), thickness: inches(3), pieces: 3, length: inches(258), longest: inches(121) }]);
  });

  it('uses the options it is given', () => {
    const p = createDefaultProject();
    const results = deriveProject(p);
    const o = resolveCutListOptions({ sheet: { kerf: 0, trim: { left: 0, right: 0, top: 0, bottom: 0 } }, lumber: { stockLengths: [inches(96)] } });
    const r = buildCutReport(p, results, o);
    expect(r.options).toBe(o);
    expect(r.sheets.every((s) => s.kerf === 0 && s.usable?.w === s.length)).toBe(true);
    expect(r.lumber.every((l) => l.stock.every((s) => s.length === inches(96)))).toBe(true);
  });

  it('is deterministic', () => {
    const p = createDefaultProject();
    const results = deriveProject(p);
    expect(buildCutReport(p, results)).toEqual(buildCutReport(p, results));
  });

  it('runs fast enough for the UI (~300 parts)', () => {
    const p = createDefaultProject();
    const run = p.runs[0]!;
    run.wall[0]!.length = inches(400);
    run.tiers[0]!.items = Array.from({ length: 14 }, (_, i) => flexBox(opening(i % 3 === 0 ? { type: 'drawer' } : { type: 'doorPair' }, i % 3 === 0 ? 0 : 2)));
    run.tiers[1]!.items = Array.from({ length: 14 }, () => flexBox(opening({ type: 'none' }, 4)));
    const results = deriveProject(p);
    const count = results.reduce((n, r) => n + r.parts.length, 0);
    expect(count).toBeGreaterThan(250);
    buildCutReport(p, results); // warm up
    const t0 = performance.now();
    const r = buildCutReport(p, results);
    const ms = performance.now() - t0;
    expect(r.cutList.totals.parts).toBe(count);
    expect(ms).toBeLessThan(250); // generous for CI; typically ~25 ms
  });

  it('handles an empty project', () => {
    const p = createDefaultProject();
    const r = buildCutReport(p, []);
    expect(r.cutList.totals.parts).toBe(0);
    expect(r.sheets).toEqual([]);
    expect(r.lumber).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(r.shopping.sheets).toEqual([]);
  });

  it('reports a missing material and a sheet material without a size', () => {
    const p = createDefaultProject();
    p.materials = p.materials.map((m) => (m.id === 'ply-7-32' ? { ...m, sheet: undefined } : m)).filter((m) => m.id !== 'poplar-3-4');
    const r = buildCutReport(p, deriveProject(p));
    expect(r.issues.filter((i) => i.code === 'cutlist-material-missing')).toHaveLength(1);
    expect(r.issues.filter((i) => i.code === 'sheet-size-missing')).toHaveLength(1);
    const back = r.sheets.find((s) => s.materialId === 'ply-7-32')!;
    expect(back.sheets).toEqual([]);
    expect(back.unplaced.every((u) => u.reason === 'no-sheet-size')).toBe(true);
    expect(r.cutList.unknown.map((g) => g.materialId)).toEqual(['poplar-3-4']);
  });
});
