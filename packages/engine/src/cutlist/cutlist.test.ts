import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../defaults';
import { deriveProject } from '../derive/index';
import type { Material, Project } from '../model';
import { inches } from '../units';
import { buildCutList, describeRowNote, glueUpPlan, rowLabel } from './cutlist';
import { DEFAULT_CUTLIST_OPTIONS, resolveCutListOptions } from './options';
import { ownerLabels } from './parts';
import { fakePart, fakeResult, projectWith } from './testing';

const O = DEFAULT_CUTLIST_OPTIONS;
const mdf: Material = { id: 'mdf', name: 'MDF 3/4"', kind: 'sheet', thickness: inches(0.75), color: '#b9a58c', sheet: { length: inches(97), width: inches(49), grain: 'none' } };

describe('rowLabel', () => {
  it('counts A … Z, AA, AB …', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(rowLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});

describe('buildCutList', () => {
  it('groups identical parts whatever their names, and keeps names and owners', () => {
    const p = projectWith();
    const parts = [
      fakePart({ length: 30, width: 15, name: 'Left side', ownerId: 'a' }),
      fakePart({ length: 30, width: 15, name: 'Right side', ownerId: 'a' }),
      fakePart({ length: 30, width: 15, name: 'Left side', ownerId: 'b' }),
      fakePart({ length: 30, width: 14, name: 'Left side', ownerId: 'b' }),
    ];
    const cl = buildCutList(p, [fakeResult(parts)], O);
    expect(cl.sheetGoods).toHaveLength(1);
    const rows = cl.sheetGoods[0]!.rows;
    expect(rows.map((r) => [r.label, r.qty, r.width])).toEqual([
      ['A', 3, inches(15)],
      ['B', 1, inches(14)],
    ]);
    expect(rows[0]!.names).toEqual(['Left side', 'Right side']);
    expect(rows[0]!.owners.map((o) => o.ownerId)).toEqual(['a', 'b']);
    expect(rows[0]!.grain).toBe('length');
  });

  it('keeps different thicknesses, materials and runs apart, sheet goods before lumber', () => {
    const p = projectWith(mdf);
    const parts = [
      fakePart({ length: 20, width: 10, materialId: 'poplar-3-4', thickness: 0.75 }),
      fakePart({ length: 20, width: 10 }),
      fakePart({ length: 20, width: 10, thickness: 0.5 }),
      fakePart({ length: 20, width: 10, materialId: 'mdf', thickness: 0.75 }),
    ];
    const cl = buildCutList(p, [fakeResult(parts.slice(0, 2), 'r1'), fakeResult(parts.slice(2), 'r2')], O);
    expect(cl.sheetGoods.map((g) => [g.materialId, g.rows.length])).toEqual([
      ['ply-23-32', 2],
      ['mdf', 1],
    ]);
    expect(cl.lumber.map((g) => g.materialId)).toEqual(['poplar-3-4']);
    expect(cl.sheetGoods[0]!.rows.map((r) => r.thickness)).toEqual([inches(23 / 32), inches(0.5)]);
    expect(cl.sheetGoods[1]!.rows[0]!.grain).toBe('any');
    expect(cl.totals).toMatchObject({ parts: 4, rows: 4 });
  });

  it('flags thickness mismatches', () => {
    const p = projectWith();
    const cl = buildCutList(p, [fakeResult([fakePart({ length: 60, width: 25, materialId: 'hardwood-top', thickness: 1.25, role: 'countertop' })])], O);
    const notes = cl.lumber[0]!.rows[0]!.notes;
    expect(notes).toContainEqual({ kind: 'thicknessMismatch', materialThickness: inches(1.5) });
  });

  it('flags parts larger than the sheet, and ones that only fit across the grain', () => {
    const p = projectWith();
    const cl = buildCutList(p, [fakeResult([fakePart({ length: 144 + 9 / 16, width: 15 + 9 / 32 }), fakePart({ length: 40, width: 90 })])], O);
    const [long, across] = cl.sheetGoods[0]!.rows;
    expect(long!.notes).toEqual([{ kind: 'exceedsSheet', sheetLength: inches(96), sheetWidth: inches(48), fitsAcrossGrain: false }]);
    expect(across!.notes).toEqual([{ kind: 'exceedsSheet', sheetLength: inches(96), sheetWidth: inches(48), fitsAcrossGrain: true }]);
    // Ignoring grain, the second one fits.
    const free = buildCutList(p, [fakeResult([fakePart({ length: 40, width: 90 })])], resolveCutListOptions({ sheet: { respectGrain: false } }));
    expect(free.sheetGoods[0]!.rows[0]!.notes).toEqual([]);
    expect(free.sheetGoods[0]!.rows[0]!.grain).toBe('any');
  });

  it('notes glue-ups and lumber longer than any stock', () => {
    const p = projectWith();
    const cl = buildCutList(
      p,
      [fakeResult([fakePart({ length: 100, width: 25, materialId: 'hardwood-top', thickness: 1.5 }), fakePart({ length: 150, width: 1.5, materialId: 'poplar-3-4', thickness: 0.75 })])],
      O,
    );
    const [poplar, top] = cl.lumber;
    expect(top!.rows[0]!.notes).toEqual([{ kind: 'glueUp', boards: 3, boardWidth: inches(8.5), boardLength: inches(100.5) }]);
    expect(poplar!.rows[0]!.notes).toEqual([{ kind: 'tooLong', stockLength: inches(144), usable: inches(143) }]);
  });

  it('puts parts with a missing material in their own group', () => {
    const p = projectWith();
    const cl = buildCutList(p, [fakeResult([fakePart({ length: 10, width: 10, materialId: 'gone' })])], O);
    expect(cl.unknown).toHaveLength(1);
    expect(cl.unknown[0]).toMatchObject({ kind: 'missing', name: 'gone' });
    expect(cl.unknown[0]!.rows[0]!.notes).toEqual([{ kind: 'missingMaterial' }]);
  });

  it('carries part notes into rows, deduplicated', () => {
    const p = projectWith();
    const note = '+1/4" each end into dados';
    const cl = buildCutList(p, [fakeResult([{ ...fakePart({ length: 20, width: 10 }), note }, { ...fakePart({ length: 20, width: 10 }), note }, fakePart({ length: 20, width: 10 })])], O);
    expect(cl.sheetGoods[0]!.rows[0]!.partNotes).toEqual([note]);
  });

  it('lists moldings as bought by length: no thickness check, no board feet', () => {
    const molding: Material = { id: 'crown', name: 'Molding (bought by length)', kind: 'lumber', thickness: inches(0.75), color: '#eee' };
    const p = projectWith(molding);
    const crown = fakePart({ length: 150, width: 4.5, thickness: 3, materialId: 'crown', role: 'molding', name: 'Crown' });
    const cl = buildCutList(p, [fakeResult([crown])], O);
    const row = cl.lumber[0]!.rows[0]!;
    expect(row.byLength).toBe(true);
    expect(row.notes).toEqual([]);
    expect(cl.lumber[0]!.boardFeet).toBe(0);
    expect(cl.lumber[0]!.linear).toBe(inches(150));
  });

  it('totals area, length and board feet', () => {
    const p = projectWith();
    const cl = buildCutList(p, [fakeResult([fakePart({ length: 24, width: 12 }), fakePart({ length: 24, width: 12 }), fakePart({ length: 96, width: 1.5, materialId: 'poplar-3-4', thickness: 0.75 })])], O);
    expect(cl.totals.sheetArea).toBe(2 * inches(24) * inches(12));
    expect(cl.totals.lumberLength).toBe(inches(96));
    expect(cl.totals.boardFeet).toBeCloseTo(0.75, 10);
  });

  it('is deterministic', () => {
    const p = createDefaultProject();
    const r = deriveProject(p);
    expect(buildCutList(p, r, O)).toEqual(buildCutList(p, r, O));
  });
});

describe('buildCutList on derived projects', () => {
  it('lists every derived part exactly once', () => {
    const p = createDefaultProject();
    const results = deriveProject(p);
    const cl = buildCutList(p, results, O);
    const keys = [...cl.sheetGoods, ...cl.lumber, ...cl.unknown].flatMap((g) => g.rows.flatMap((r) => r.parts.map((x) => x.key)));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(results.reduce((n, r) => n + r.parts.length, 0));
    // Face frame parts are lumber; carcass panels are sheet goods.
    expect(cl.lumber.flatMap((g) => g.rows.flatMap((r) => r.roles))).toContain('stile');
    expect(cl.sheetGoods.flatMap((g) => g.rows.flatMap((r) => r.roles))).toContain('side');
  });

  it('labels owners by tier and position, or by name', () => {
    const p: Project = createDefaultProject();
    const run = p.runs[0]!;
    const named = run.tiers[0]!.items[1]!;
    if (named.kind === 'box') named.name = 'Sink base';
    const labels = ownerLabels(p);
    const ids = run.tiers[0]!.items.map((i) => (i.kind === 'box' ? i.id : ''));
    expect(ids.map((id) => labels.get(`${run.id}:${id}`)?.label)).toEqual(['Base 1', 'Sink base', 'Base 3', 'Base 4']);
    expect(labels.get(`${run.id}:${run.tiers[0]!.id}`)?.label).toBe('Base');
  });
});

describe('glueUpPlan and notes', () => {
  it('splits into the fewest boards no wider than the max', () => {
    const o = DEFAULT_CUTLIST_OPTIONS.lumber;
    const grid = inches(1 / 32);
    expect(glueUpPlan(inches(11.25), inches(50), o, grid)).toBeNull();
    expect(glueUpPlan(inches(17.75), inches(50), o, grid)).toEqual({ boards: 2, boardWidth: inches(9.125), boardLength: inches(50.5) });
    expect(glueUpPlan(inches(22.25), inches(50), o, grid)).toEqual({ boards: 3, boardWidth: inches(7.59375), boardLength: inches(50.5) });
    expect(glueUpPlan(inches(30), inches(50), { ...o, maxBoardWidth: 0 }, grid)).toBeNull();
  });

  it('describes notes in the caller’s units', () => {
    const fmt = (t: number) => `${t / inches(1)}in`;
    expect(describeRowNote({ kind: 'glueUp', boards: 2, boardWidth: inches(9), boardLength: inches(50) }, fmt)).toBe('Glue-up: 2 boards 9in wide × 50in');
    expect(describeRowNote({ kind: 'exceedsSheet', sheetLength: inches(96), sheetWidth: inches(48), fitsAcrossGrain: true }, fmt)).toContain('fits across it');
    expect(describeRowNote({ kind: 'thicknessMismatch', materialThickness: inches(1.5) }, fmt)).toBe('Material is 1.5in thick');
  });
});
