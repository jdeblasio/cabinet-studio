import { createDefaultProject, inches, newId, opening, type Box, type Project, type Split, type Ticks } from '@built-in-planner/engine';
import { describe, expect, it } from 'vitest';
import { getRunResult } from '../../store/derived';
import { computeHandles, type BoundaryHandle } from './geometry';
import { solveDrag, snapTargets } from './snap';

const GRID = inches(1 / 32);
const OPTS = { grid: GRID, threshold: inches(0.5), snap: true };

/** Default project with a 30" gap at the right end of the base tier (3 base boxes) and a fixed 30" last upper box. */
function gapProject(): Project {
  const project = createDefaultProject();
  const run = project.runs[0]!;
  const [base, upper] = run.tiers;
  const gapId = newId();
  run.spans.push({ id: gapId, kind: 'gap', x: { anchor: 'right', offset: 0 }, width: inches(30), tiers: { from: base!.id, to: base!.id }, content: opening() });
  base!.items = [...base!.items.slice(0, 3), { kind: 'slot', spanId: gapId }];
  (upper!.items[3] as Box).width = { kind: 'fixed', size: inches(30) };
  return project;
}

function handleBetween(project: Project, a: string, b: string): BoundaryHandle {
  const run = project.runs[0]!;
  const h = computeHandles(run, getRunResult(project, run.id), inches(2)).find((x) => x.key === `items:${a}|${b}`);
  if (!h) throw new Error('handle not found');
  return h;
}

const boxIds = (project: Project, tier: number) => project.runs[0]!.tiers[tier]!.items.filter((i): i is Box => i.kind === 'box').map((b) => b.id);
const rightEdge = (project: Project, tier: number, id: string): Ticks => {
  const r = getRunResult(project, project.runs[0]!.id);
  const it = r.tiers[tier]!.items.find((i) => i.id === id)!;
  return it.x + it.width;
};

describe('solveDrag snapping', () => {
  it('lands an upper boundary exactly on the edge of the box below, despite flex rounding', () => {
    const p = gapProject();
    const runId = p.runs[0]!.id;
    const [, , u3, u4] = boxIds(p, 1);
    const target = rightEdge(p, 0, boxIds(p, 0)[2]!); // left edge of the gap
    const h = handleBetween(p, u3!, u4!);
    expect(h.pos).not.toBe(target); // 1/32" off before snapping
    const sol = solveDrag(p, runId, h, inches(0.1), OPTS);
    expect(sol.guide).toEqual({ axis: 'x', pos: target });
    expect(rightEdge(sol.project, 1, u3!)).toBe(target);
    // Boxes keep their type: the fixed box absorbs the change, and the flex boxes stay equal.
    const items = sol.project.runs[0]!.tiers[1]!.items as Box[];
    expect(items[3]).toMatchObject({ width: { kind: 'fixed' } });
    expect(items.slice(0, 3).map((b) => b.width)).toEqual([0, 1, 2].map(() => ({ kind: 'flex', ratio: 1 })));
  });

  it('reaches an edge that equal flex boxes can\'t land on by nudging the neighbor\'s ratio', () => {
    // A full-width end stile beside the gap moves the lower box's edge 23/32" left, to a position
    // the upper boundary can't reach with three equal flex boxes and a split scribe remainder.
    const p = gapProject();
    const base = p.runs[0]!.tiers[0]!.items.filter((i): i is Box => i.kind === 'box');
    base[2]!.overrides = { faceFrame: { endStiles: { right: 'full' } } };
    const runId = p.runs[0]!.id;
    const [u1, u2, u3, u4] = boxIds(p, 1);
    const target = rightEdge(p, 0, base[2]!.id);
    const h = handleBetween(p, u3!, u4!);
    // Out of reach for a plain drag (which keeps the flex boxes equal) at any nearby grid step.
    for (let k = -6; k <= 6; k++) {
      const plain = solveDrag(p, runId, h, target - h.pos + k * GRID, { ...OPTS, snap: false });
      expect(rightEdge(plain.project, 1, u3!)).not.toBe(target);
    }
    const sol = solveDrag(p, runId, h, target - h.pos + inches(0.1), OPTS);
    expect(sol.guide).toEqual({ axis: 'x', pos: target });
    expect(rightEdge(sol.project, 1, u3!)).toBe(target);
    const widths = (sol.project.runs[0]!.tiers[1]!.items as Box[]).map((b) => b.width);
    expect(widths.slice(0, 2)).toEqual([0, 1].map(() => ({ kind: 'flex', ratio: 1 })));
    expect(widths[2]).toMatchObject({ kind: 'flex' });
    expect(Math.abs((widths[2] as { ratio: number }).ratio - 1)).toBeLessThan(0.01);
    expect(widths[3]).toMatchObject({ kind: 'fixed' });
    void u1;
    void u2;
  });

  it('aligns two flex boxes with the boxes below', () => {
    const p = gapProject();
    const runId = p.runs[0]!.id;
    const [u1, u2] = boxIds(p, 1);
    const target = rightEdge(p, 0, boxIds(p, 0)[0]!);
    const h = handleBetween(p, u1!, u2!);
    const sol = solveDrag(p, runId, h, target - h.pos - inches(0.2), OPTS);
    expect(sol.guide?.pos).toBe(target);
    expect(rightEdge(sol.project, 1, u1!)).toBe(target);
    expect(sol.project.runs[0]!.tiers[1]!.items[0]).toMatchObject({ width: { kind: 'flex' } });
  });

  it('does not snap when far from a target or when snapping is off', () => {
    const p = gapProject();
    const runId = p.runs[0]!.id;
    const [u1, u2] = boxIds(p, 1);
    const h = handleBetween(p, u1!, u2!);
    expect(solveDrag(p, runId, h, inches(5), OPTS).guide).toBeUndefined();
    const target = rightEdge(p, 0, boxIds(p, 0)[0]!);
    expect(solveDrag(p, runId, h, target - h.pos + inches(0.1), { ...OPTS, snap: false }).guide).toBeUndefined();
  });

  it('does not offer the edges of boxes in the same tier as targets', () => {
    const p = gapProject();
    const [u1, u2] = boxIds(p, 1);
    const h = handleBetween(p, u1!, u2!);
    const targets = snapTargets(getRunResult(p, p.runs[0]!.id), h);
    expect(targets).not.toContain(h.pos);
    expect(targets).toContain(rightEdge(p, 0, boxIds(p, 0)[0]!));
  });

  it('lines up drawer rails across neighboring boxes', () => {
    const p = createDefaultProject();
    const run = p.runs[0]!;
    const drawerOverDoors = (drawer: number): Split => ({
      kind: 'split',
      id: newId(),
      direction: 'rows',
      divider: 'frameOnly',
      children: [
        { size: { kind: 'fixed', size: inches(drawer) }, section: opening({ type: 'drawer' }) },
        { size: { kind: 'flex', ratio: 1 }, section: opening({ type: 'doorPair' }, 1) },
      ],
    });
    const [b1, b2] = run.tiers[0]!.items as Box[];
    const s1 = drawerOverDoors(6);
    b1!.content = s1;
    b2!.content = drawerOverDoors(7);
    const result = getRunResult(p, run.id);
    const h = computeHandles(run, result, inches(2)).find((x) => x.key === `split:${s1.id}:0`)!;
    // A bigger drawer moves the rail down; drag about an inch down toward the 7" drawer's rail.
    const sol = solveDrag(p, run.id, h, -inches(0.9), OPTS);
    expect(sol.guide?.axis).toBe('y');
    const split = sol.project.runs[0]!.tiers[0]!.items[0] as Box;
    expect((split.content as Split).children[0]!.size).toEqual({ kind: 'fixed', size: inches(7) });
  });
});
