import { describe, expect, it } from 'vitest';
import type { Part, RunResult } from '../derived';
import { createDefaultProject, flexBox, newId, opening } from '../defaults';
import type { Box, Project, Run, Span, Split, Tier } from '../model';
import { inches, mm } from '../units';
import { deriveRun } from './index';

const T = inches(23 / 32); // default carcass thickness
const TB = inches(7 / 32); // default back thickness

function setup(mutate?: (p: Project, run: Run) => void): { project: Project; run: Run; result: RunResult } {
  const project = createDefaultProject();
  const run = project.runs[0]!;
  mutate?.(project, run);
  return { project, run, result: deriveRun(project, run.id) };
}

const tier = (run: Run, i: number): Tier => run.tiers[i]!;
const boxesOf = (t: Tier): Box[] => t.items.filter((it): it is Box => it.kind === 'box');
const part = (r: RunResult, id: string): Part => {
  const p = r.parts.find((pp) => pp.id === id);
  if (!p) throw new Error(`part ${id} not found`);
  return p;
};
const nonInfo = (r: RunResult) => r.issues.filter((i) => i.severity !== 'info');

describe('deriveRun: default project', () => {
  const { run, result } = setup();
  const base = tier(run, 0);
  const upper = tier(run, 1);

  it('has no problems', () => {
    expect(result.issues).toEqual([]);
  });

  it('stacks tiers bottom to top with the ceiling scribe left over', () => {
    const [tb, tu] = result.tiers;
    expect(tb).toMatchObject({ y: 0, height: inches(30), toeKick: inches(3.5) });
    expect(tu).toMatchObject({ y: inches(30), height: inches(65.5), toeKick: 0 });
    expect(result.ceilingGap).toBe(inches(0.5));
  });

  it('flexes four identical boxes between the wall scribes', () => {
    const xs = result.tiers[0]!.items.map((it) => it.x);
    expect(xs).toEqual([0.5, 30.25, 60, 89.75].map(inches));
    expect(result.tiers[0]!.items.every((it) => it.width === inches(29.75))).toBe(true);
    expect(result.tiers[0]!.scribe).toEqual({ left: inches(0.5), right: inches(0.5) });
  });

  it('places base carcasses on the toe kick', () => {
    const b = result.boxes.find((bx) => bx.id === boxesOf(base)[0]!.id)!;
    expect(b.carcass).toEqual({ x: inches(0.5), y: inches(3.5), z: 0, width: inches(29.75), height: inches(26.5), depth: inches(16) });
  });

  it('derives carcass parts with butt-joint sizes', () => {
    const id = boxesOf(base)[0]!.id;
    const side = part(result, `${id}/side-left`);
    expect([side.length, side.width, side.thickness]).toEqual([inches(26.5), inches(16) - TB, T]);
    const top = part(result, `${id}/top`);
    expect([top.length, top.width]).toEqual([inches(29.75) - 2 * T, inches(16) - TB]);
    const back = part(result, `${id}/back`);
    expect([back.length, back.width, back.thickness]).toEqual([inches(26.5), inches(29.75), TB]);
    // Bottom panel's top surface is flush with the top of the 1 1/2" bottom rail.
    const bottom = part(result, `${id}/bottom`);
    expect(bottom.bounds.y + bottom.bounds.height).toBe(inches(3.5 + 1.5));
  });

  it('derives a continuous face frame: shared stiles flush inside, scribe stiles at the walls', () => {
    const ids = boxesOf(base).map((b) => b.id);
    const left = part(result, `${ids[0]}/stile-left`);
    expect(left.name).toBe('Scribe stile');
    expect(left.width).toBe(inches(0.5) + T);
    expect(left.bounds.x).toBe(0);
    const shared = part(result, `${ids[1]}/stile-left`);
    expect(shared.name).toBe('Shared stile');
    expect(shared.width).toBe(2 * T);
    expect(shared.bounds.x).toBe(inches(30.25) - T);
    const right = part(result, `${ids[3]}/stile-right`);
    expect(right.bounds.x + right.bounds.width).toBe(inches(120));
    // Base (16" deep) and upper (12" deep) are different face planes → two frames.
    expect(result.frames).toHaveLength(2);
    const rail = part(result, `${ids[0]}/rail-top`);
    expect(rail.length).toBe(inches(29.75) - 2 * T);
  });

  it('sizes partial-overlay door pairs from the clear opening', () => {
    const op = boxesOf(base)[0]!.content;
    const l = part(result, `${op.id}/door-left`);
    const r = part(result, `${op.id}/door-right`);
    // Opening 28 5/16" × 23 1/2"; +1/2" overlay each edge; 1/8" between the pair.
    expect([l.width, l.length]).toEqual([inches(14 + 19 / 32), inches(24.5)]);
    expect(r.bounds.x - (l.bounds.x + l.bounds.width)).toBe(inches(1 / 8));
    expect(l.bounds.z).toBe(inches(16) + inches(0.75));
  });

  it('sizes adjustable shelves inside the carcass', () => {
    const op = boxesOf(upper)[0]!.content;
    const shelves = result.parts.filter((p) => p.id.startsWith(`${op.id}/adj-shelf-`));
    expect(shelves).toHaveLength(3);
    expect(shelves[0]!.length).toBe(inches(29.75) - 2 * T - inches(1 / 16));
    expect(shelves[0]!.width).toBe(inches(12) - TB - inches(1 / 4));
    const ys = shelves.map((s) => s.bounds.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('builds one toe kick platform under the contiguous base boxes', () => {
    const kick = result.parts.filter((p) => p.role === 'toeKick');
    const front = kick.find((p) => p.id.endsWith('-front'))!;
    expect(front.length).toBe(inches(119));
    expect(front.width).toBe(inches(3.5));
    // Kick face 3" back from the face of the frame.
    expect(front.bounds.z + front.bounds.depth).toBe(inches(16 + 0.75 - 3));
    expect(kick.filter((p) => p.name === 'Toe kick (cross)')).toHaveLength(5);
  });

  it('gives every part a unique id', () => {
    expect(new Set(result.parts.map((p) => p.id)).size).toBe(result.parts.length);
  });

  it('flattens each box section tree with face rects', () => {
    const b = result.boxes[0]!;
    expect(b.sections).toHaveLength(1);
    expect(b.sections[0]!.rect).toEqual({ x: inches(0.5) + T, y: inches(5), width: inches(29.75) - 2 * T, height: inches(23.5) });
  });
});

describe('deriveRun: remainders and errors', () => {
  it('sends the flex snap remainder to the wall-end scribes', () => {
    const { result } = setup((_, run) => {
      tier(run, 0).items.pop(); // 3 boxes: 119 / 3 is off-grid
    });
    const t = result.tiers[0]!;
    expect(t.items.every((it) => it.width === inches(39 + 21 / 32))).toBe(true);
    expect(t.scribe.left + t.scribe.right).toBe(inches(1 + 1 / 32));
  });

  it('reports boxes that overflow a tier', () => {
    const { result } = setup((_, run) => {
      for (const b of boxesOf(tier(run, 0))) b.width = { kind: 'fixed', size: inches(36) };
    });
    expect(result.issues.map((i) => i.code)).toContain('tier-overflow');
  });

  it('notes off-grid material thickness', () => {
    const { result } = setup((p) => {
      p.materials.push({ id: 'bb-18', name: 'Baltic birch 18 mm', kind: 'sheet', thickness: mm(18), color: '#eee' });
      p.settings = { ...p.settings, materials: { ...p.settings.materials, carcass: 'bb-18' } };
    });
    expect(result.issues.find((i) => i.code === 'material-off-grid')?.severity).toBe('info');
    const top = result.parts.find((pp) => pp.role === 'top')!;
    expect(top.length % inches(1 / 32)).toBe(0);
    expect(top.length).toBeLessThan(inches(29.75) - 2 * mm(18));
  });
});

describe('deriveRun: spans', () => {
  function addSpan(run: Run, span: Partial<Span> & Pick<Span, 'kind' | 'x' | 'width' | 'tiers'>, slotIndex: (t: Tier) => number) {
    const s: Span = { id: newId(), content: opening({ type: 'doorPair' }, 4), ...span };
    run.spans.push(s);
    const from = run.tiers.findIndex((t) => t.id === s.tiers.from);
    const to = run.tiers.findIndex((t) => t.id === s.tiers.to);
    for (let i = from; i <= to; i++) {
      const t = run.tiers[i]!;
      t.items.splice(slotIndex(t), 0, { kind: 'slot', spanId: s.id });
    }
    return s;
  }

  it('reserves a slot for a tall box spanning both tiers; tiers flex around it', () => {
    let span!: Span;
    const { run, result } = setup((_, r) => {
      span = addSpan(r, { kind: 'box', x: { anchor: 'right', offset: 0 }, width: inches(24), tiers: { from: tier(r, 0).id, to: tier(r, 1).id } }, (t) => t.items.length);
    });
    expect(nonInfo(result)).toEqual([]);
    for (const t of result.tiers) {
      expect(t.items.slice(0, 4).every((it) => it.width === inches(23.75))).toBe(true);
      expect(t.items[4]).toMatchObject({ kind: 'slot', id: span.id, x: inches(95.5), width: inches(24) });
    }
    const tall = result.boxes.find((b) => b.id === span.id)!;
    expect(tall.carcass).toMatchObject({ y: inches(3.5), height: inches(92), depth: inches(16) });
    // Same face plane as the base: the shared stile runs the tall box's full height.
    const shared = part(result, `${span.id}/stile-left`);
    expect(shared.name).toBe('Shared stile');
    expect([shared.bounds.y, shared.bounds.height]).toEqual([inches(3.5), inches(92)]);
    expect(part(result, `${span.id}/stile-right`).name).toBe('Scribe stile');
    // Toe kick runs under the tall box too.
    const front = result.parts.find((p) => p.id.endsWith('kick-0-front'))!;
    expect(front.length).toBe(inches(119));
    void run;
  });

  it('splits a tier around a centered gap; stiles beside the gap are flush', () => {
    let gap!: Span;
    const { result } = setup((_, r) => {
      gap = addSpan(r, { kind: 'gap', x: { anchor: 'center', offset: 0 }, width: inches(36), tiers: { from: tier(r, 0).id, to: tier(r, 0).id } }, () => 2);
    });
    expect(nonInfo(result)).toEqual([]);
    const items = result.tiers[0]!.items;
    expect(items.map((i) => i.kind)).toEqual(['box', 'box', 'slot', 'box', 'box']);
    expect(items[2]).toMatchObject({ x: inches(42), width: inches(36) });
    expect(items.filter((i) => i.kind === 'box').every((i) => i.width === inches(20.75))).toBe(true);
    expect(result.gaps[0]).toEqual({ spanId: gap.id, rect: { x: inches(42), y: 0, width: inches(36), height: inches(30) } });
    const besideGap = result.parts.find((p) => p.id === `${items[1]!.id}/stile-right`)!;
    expect(besideGap.name).toBe('End stile');
    expect(besideGap.width).toBe(T);
    // Two separate toe kick platforms.
    expect(result.parts.filter((p) => p.name === 'Toe kick (front)')).toHaveLength(2);
  });

  it('flags a missing slot', () => {
    const { result } = setup((_, r) => {
      r.spans.push({ id: newId(), kind: 'box', x: { anchor: 'left', offset: 0 }, width: inches(24), tiers: { from: tier(r, 0).id, to: tier(r, 0).id }, content: opening() });
    });
    expect(result.issues.map((i) => i.code)).toContain('span-slot-missing');
  });
});

describe('deriveRun: splits', () => {
  it('stacks a fixed drawer opening over flex doors with a mid rail and no shelf (frameOnly)', () => {
    let split!: Split;
    const { result } = setup((_, r) => {
      split = {
        kind: 'split',
        id: newId(),
        direction: 'rows',
        divider: 'frameOnly',
        children: [
          { size: { kind: 'fixed', size: inches(6) }, section: opening({ type: 'drawer' }) },
          { size: { kind: 'flex', ratio: 1 }, section: opening({ type: 'doorPair' }) },
        ],
      };
      tier(r, 0).items[0] = { ...flexBox(split), id: newId() };
    });
    expect(nonInfo(result)).toEqual([]);
    const [drawer, doors] = split.children.map((c) => c.section);
    const rail = part(result, `${split.id}/rail-0`);
    expect(rail.width).toBe(inches(1.5));
    expect(result.parts.some((p) => p.id === `${split.id}/shelf-0`)).toBe(false);
    const front = part(result, `${drawer!.id}/drawer-front`);
    expect(front.width).toBe(inches(7)); // 6" opening + 2 × 1/2" overlay; horizontal grain → width is height
    const box = result.boxes[0]!;
    const doorRect = box.sections.find((s) => s.sectionId === doors!.id)!.rect;
    expect(doorRect.height).toBe(inches(23.5 - 6 - 1.5));
  });

  it('adds partitions and mid stiles for a column split with panels', () => {
    let split!: Split;
    const { result } = setup((_, r) => {
      split = {
        kind: 'split',
        id: newId(),
        direction: 'columns',
        divider: 'panel',
        children: [0, 1].map(() => ({ size: { kind: 'flex' as const, ratio: 1 }, section: opening({ type: 'none' }, 2) })),
      };
      tier(r, 1).items[0] = flexBox(split);
    });
    expect(nonInfo(result)).toEqual([]);
    const stile = part(result, `${split.id}/stile-0`);
    const partition = part(result, `${split.id}/partition-0`);
    expect(partition.thickness).toBe(T);
    expect(partition.bounds.x + partition.bounds.width / 2).toBe(stile.bounds.x + stile.bounds.width / 2);
  });
});

describe('deriveRun: front mounting', () => {
  const withMounting = (mounting: 'inset' | 'fullOverlay') =>
    setup((p) => {
      p.settings = { ...p.settings, fronts: { ...p.settings.fronts, mounting } };
    });

  it('insets fronts by the reveal, flush with the face of the frame', () => {
    const { run, result } = withMounting('inset');
    const op = boxesOf(tier(run, 0))[0]!.content;
    const l = part(result, `${op.id}/door-left`);
    expect([l.width, l.length]).toEqual([inches(14 + 1 / 32), inches(23.375)]);
    expect(l.bounds.z + l.bounds.depth).toBe(inches(16 + 0.75));
  });

  it('full overlay leaves exactly the reveal between fronts across a shared stile', () => {
    const { run, result } = withMounting('fullOverlay');
    const [a, b] = boxesOf(tier(run, 0)).map((bx) => bx.content.id);
    const right = part(result, `${a}/door-right`);
    const left = part(result, `${b}/door-left`);
    expect(left.bounds.x - (right.bounds.x + right.bounds.width)).toBe(inches(1 / 16));
    expect(right.width).toBe(inches(14 + 25 / 32));
  });
});
