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
const counters = (r: RunResult) => r.parts.filter((p) => p.role === 'countertop');

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
    // The front board runs wall to wall; the platform behind it sits under the carcasses.
    expect(front.length).toBe(inches(120));
    expect(kick.find((p) => p.id.endsWith('-back'))!.length).toBe(inches(119));
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
    // Toe kick runs under the tall box too, and its front board on to both walls.
    const front = result.parts.find((p) => p.id.endsWith('kick-0-front'))!;
    expect(front.length).toBe(inches(120));
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

  describe('full-width end stiles', () => {
    const centeredGap = (r: Run) =>
      addSpan(r, { kind: 'gap', name: 'Fireplace', x: { anchor: 'center', offset: 0 }, width: inches(36), tiers: { from: tier(r, 0).id, to: tier(r, 0).id } }, () => 2);
    const edgeOf = (r: RunResult, id: string) => {
      const it = r.tiers[0]!.items.find((i) => i.id === id)!;
      return [it.x, it.x + it.width];
    };

    it('shrinks the flex boxes so the stile stops at the gap, with an end panel behind it', () => {
      const { run, result } = setup((_, r) => {
        centeredGap(r);
        boxesOf(tier(r, 0))[1]!.overrides = { faceFrame: { endStiles: { right: 'full' } } };
      });
      expect(result.issues).toEqual([]);
      const [b0, b1, b2] = boxesOf(tier(run, 0)).map((b) => b.id);
      // 41 1/2" region less the 23/32" reserve: two 20 3/8" boxes, the 1/32" remainder at the wall.
      expect(edgeOf(result, b0!)).toEqual([inches(0.5 + 1 / 32), inches(0.5 + 1 / 32 + 20.375)]);
      expect(edgeOf(result, b1!)[1]).toBe(inches(42) - T);
      const stile = part(result, `${b1}/stile-right`);
      expect(stile.name).toBe('End stile');
      expect([stile.bounds.x, stile.width]).toEqual([inches(42) - 2 * T, 2 * T]);
      const panel = part(result, `${b1}/end-panel-right`);
      expect(panel.bounds).toMatchObject({ x: inches(42) - T, z: 0, width: T, depth: inches(16), y: inches(3.5), height: inches(26.5) });
      expect(panel.thickness).toBe(T);
      // The other side of the gap is untouched.
      expect(part(result, `${b2}/stile-left`).width).toBe(T);
      expect(result.parts.some((p) => p.id === `${b2}/end-panel-left`)).toBe(false);
    });

    it('cascades from the tier to every open edge, leaving wall and shared stiles alone', () => {
      const { result } = setup((_, r) => {
        centeredGap(r);
        tier(r, 0).overrides = { faceFrame: { endStiles: { left: 'full', right: 'full' } } };
      });
      const items = result.tiers[0]!.items;
      expect(part(result, `${items[3]!.id}/stile-left`)).toMatchObject({ width: 2 * T, bounds: expect.objectContaining({ x: inches(78) }) });
      // The reserve leaves a 1/32" flex remainder, which goes to the wall scribe.
      expect(part(result, `${items[0]!.id}/stile-left`)).toMatchObject({ name: 'Scribe stile', width: inches(0.5 + 1 / 32) + T });
      expect(part(result, `${items[1]!.id}/stile-left`)).toMatchObject({ name: 'Shared stile', width: 2 * T });
      expect(result.parts.filter((p) => p.name === 'End panel')).toHaveLength(2);
      expect(result.issues).toEqual([]);
    });

    it('lines up with a shared stile in a shallower tier above', () => {
      // Gap at the right end of the base tier only; the 12"-deep uppers run full width above it.
      const gapAtRight = (r: Run) => {
        addSpan(r, { kind: 'gap', x: { anchor: 'right', offset: 0 }, width: inches(30), tiers: { from: tier(r, 0).id, to: tier(r, 0).id } }, (t) => t.items.length);
        const base = boxesOf(tier(r, 0));
        base[base.length - 1]!.overrides = { faceFrame: { endStiles: { right: 'full' } } };
      };
      const probeItems = setup((_, r) => gapAtRight(r)).result.tiers[0]!.items.filter((i) => i.kind === 'box');
      const lowerEdge = probeItems.at(-1)!.x + probeItems.at(-1)!.width;
      // Put an upper boundary on the lower box's edge: a fixed first box, then a flex box.
      let upperIds!: string[];
      const { result: aligned } = setup((_, r) => {
        gapAtRight(r);
        const up = tier(r, 1);
        up.items = [flexBox(opening(), 1), flexBox(opening(), 1)];
        (up.items[0] as Box).width = { kind: 'fixed', size: lowerEdge - inches(0.5) };
        upperIds = boxesOf(up).map((b) => b.id);
      });
      expect(nonInfo(aligned)).toEqual([]);
      const lowerId = aligned.tiers[0]!.items.filter((i) => i.kind === 'box').at(-1)!.id;
      const lower = part(aligned, `${lowerId}/stile-right`);
      const upper = part(aligned, `${upperIds[1]}/stile-left`);
      expect(upper.name).toBe('Shared stile');
      expect([lower.bounds.x, lower.width]).toEqual([upper.bounds.x, upper.width]);
      expect(lower.bounds.x + lower.width).toBe(aligned.gaps[0]!.rect.x);
      expect(lower.bounds.z).not.toBe(upper.bounds.z);
    });

    it('runs the toe kick under the end panel, flush with the finished end', () => {
      const { run, result } = setup((_, r) => {
        centeredGap(r);
        boxesOf(tier(r, 0))[1]!.overrides = { faceFrame: { endStiles: { right: 'full' } } };
      });
      const kick = result.parts.filter((p) => p.ownerId === tier(run, 0).id && p.id.includes('/kick-0-'));
      const front = kick.find((p) => p.id.endsWith('-front'))!;
      const back = kick.find((p) => p.id.endsWith('-back'))!;
      // Gap edge at 42": the platform ends flush with the end panel's outer face.
      expect(back.bounds.x + back.bounds.width).toBe(inches(42));
      expect(front.bounds.x).toBe(0); // and runs to the left wall
      expect(front.bounds.x + front.bounds.width).toBe(inches(42));
      const crosses = kick.filter((p) => p.name === 'Toe kick (cross)');
      expect(Math.max(...crosses.map((c) => c.bounds.x + c.bounds.width))).toBe(inches(42));
      // The other platform, beside a flush end stile, stops at the carcass side.
      const other = result.parts.find((p) => p.id.endsWith('/kick-1-back'))!;
      expect(other.bounds.x).toBe(inches(78));
    });

    it('makes room beside a box with a different face plane instead of overrunning it', () => {
      let tall!: Span;
      const { run, result } = setup((_, r) => {
        tall = addSpan(r, { kind: 'box', x: { anchor: 'right', offset: 0 }, width: inches(24), depth: inches(12), tiers: { from: tier(r, 0).id, to: tier(r, 1).id } }, (t) => t.items.length);
        const base = boxesOf(tier(r, 0));
        base[base.length - 1]!.overrides = { faceFrame: { endStiles: { right: 'full' } } };
      });
      expect(result.issues.map((i) => i.code)).not.toContain('end-stile-overlap');
      const last = boxesOf(tier(run, 0)).at(-1)!.id;
      const tallX = result.boxes.find((b) => b.id === tall.id)!.carcass.x;
      expect(edgeOf(result, last)[1]).toBe(tallX - T);
      expect(part(result, `${last}/end-panel-right`).bounds.x).toBe(tallX - T);
    });
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
    // Over a partition the stile matches a shared stile, not the 1 1/2" stile-only width.
    expect(stile.width).toBe(2 * T);
  });

  it('lines a partition stile up exactly with a shared stile in the tier below', () => {
    let split!: Split;
    const { run, result } = setup((_, r) => {
      // One 119"-wide upper box split over the base boundary at 30 1/4": 29 3/4" box edge minus the side.
      split = {
        kind: 'split',
        id: newId(),
        direction: 'columns',
        divider: 'panel',
        children: [
          { size: { kind: 'fixed', size: inches(29.75) - 2 * T }, section: opening() },
          { size: { kind: 'flex', ratio: 1 }, section: opening() },
        ],
      };
      tier(r, 1).items = [flexBox(split)];
    });
    expect(nonInfo(result)).toEqual([]);
    const upper = part(result, `${split.id}/stile-0`);
    const lower = part(result, `${boxesOf(tier(run, 0))[1]!.id}/stile-left`);
    expect([upper.bounds.x, upper.width]).toEqual([lower.bounds.x, lower.width]);
  });

  it('keeps the stile-only width for frame-only column dividers', () => {
    let split!: Split;
    const { result } = setup((_, r) => {
      split = {
        kind: 'split',
        id: newId(),
        direction: 'columns',
        divider: 'frameOnly',
        children: [0, 1].map(() => ({ size: { kind: 'flex' as const, ratio: 1 }, section: opening() })),
      };
      tier(r, 1).items[0] = flexBox(split);
    });
    expect(part(result, `${split.id}/stile-0`).width).toBe(inches(1.5));
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

describe('deriveRun: countertops', () => {
  const CT = { thickness: inches(1.5), frontOverhang: inches(1), endOverhang: inches(1) };
  const withCounter = (more?: (p: Project, r: Run) => void) =>
    setup((p, r) => {
      tier(r, 0).countertop = { ...CT };
      more?.(p, r);
    });

  it('sits inside the tier band, wall to wall, past the face of the frame', () => {
    const { run, result } = withCounter();
    expect(result.issues).toEqual([]);
    expect(result.tiers[0]).toMatchObject({ height: inches(30), toeKick: inches(3.5), countertop: inches(1.5) });
    const box = result.boxes.find((b) => b.id === boxesOf(tier(run, 0))[0]!.id)!;
    expect([box.carcass.y, box.carcass.height]).toEqual([inches(3.5), inches(25)]);
    const [top] = counters(result);
    expect(top!.bounds).toEqual({ x: 0, y: inches(28.5), z: 0, width: inches(120), height: inches(1.5), depth: inches(16 + 0.75 + 1) });
    expect([top!.length, top!.width, top!.thickness]).toEqual([inches(120), inches(17.75), inches(1.5)]);
    expect(top!.materialId).toBe('hardwood-top');
    // The upper tier still starts on top of the band, i.e. on the countertop, so its bottoms aren't exposed.
    expect(result.tiers[1]!.y).toBe(inches(30));
    expect(result.parts.filter((p) => p.name === 'Finished bottom')).toEqual([]);
  });

  it('splits at a gap and overhangs into it', () => {
    const gapIn = (r: Run) => {
      const id = newId();
      r.spans.push({ id, kind: 'gap', x: { anchor: 'center', offset: 0 }, width: inches(36), tiers: { from: tier(r, 0).id, to: tier(r, 0).id }, content: opening() });
      tier(r, 0).items.splice(2, 0, { kind: 'slot', spanId: id });
    };
    const flush = counters(withCounter((_, r) => gapIn(r)).result);
    expect(flush.map((c) => [c.bounds.x, c.bounds.x + c.bounds.width])).toEqual([
      [0, inches(43)],
      [inches(77), inches(120)],
    ]);
    // Full-width end stiles stop at the gap edge too, so the overhang is the same.
    const full = counters(
      withCounter((_, r) => {
        gapIn(r);
        tier(r, 0).overrides = { faceFrame: { endStiles: { left: 'full', right: 'full' } } };
      }).result,
    );
    expect(full.map((c) => [c.bounds.x, c.bounds.x + c.bounds.width])).toEqual([
      [0, inches(43)],
      [inches(77), inches(120)],
    ]);
  });

  it('stops at a tall box beside it and notes the stile notch', () => {
    const { result } = withCounter((_, r) => {
      const id = newId();
      r.spans.push({ id, kind: 'box', x: { anchor: 'right', offset: 0 }, width: inches(24), tiers: { from: tier(r, 0).id, to: tier(r, 1).id }, content: opening() });
      for (const t of r.tiers) t.items.push({ kind: 'slot', spanId: id });
    });
    const [top] = counters(result);
    expect(top!.bounds.x + top!.bounds.width).toBe(inches(95.5));
    expect(nonInfo(result)).toEqual([]);
    expect(result.issues.map((i) => i.code)).toContain('countertop-notch');
  });

  it('rejects a countertop thicker than the boxes are tall', () => {
    const { result } = withCounter((_, r) => {
      tier(r, 0).countertop = { ...CT, thickness: inches(27) };
    });
    expect(result.issues.map((i) => i.code)).toContain('countertop-too-thick');
    expect(counters(result)).toEqual([]);
  });
});

describe('deriveRun: open carcass tops and bottoms', () => {
  it('a hutch: upper boxes with open bottoms sit on the countertop, which shows as the bottom shelf', () => {
    const { run, result } = setup((_, r) => {
      tier(r, 0).countertop = { thickness: inches(1.5), frontOverhang: inches(1), endOverhang: inches(1) };
      tier(r, 1).overrides = { carcass: { bottom: 'open' } };
    });
    expect(nonInfo(result)).toEqual([]);
    const up = boxesOf(tier(run, 1))[0]!;
    const ids = result.parts.filter((p) => p.ownerId === up.id).map((p) => p.id);
    expect(ids).not.toContain(`${up.id}/bottom`);
    expect(ids).not.toContain(`${up.id}/rail-bottom`);
    expect(ids).toContain(`${up.id}/top`);
    const layout = result.boxes.find((b) => b.id === up.id)!;
    const counterTop = counters(result)[0]!;
    expect(layout.carcass.y).toBe(counterTop.bounds.y + counterTop.bounds.height);
    // The face opening and the shelf spacing start at the countertop.
    expect(layout.sections[0]!.rect.y).toBe(layout.carcass.y);
    const shelves = result.parts.filter((p) => p.id.startsWith(`${up.content.id}/adj-shelf`));
    const interior = inches(96 - 0.5) - T - layout.carcass.y; // carcass top (under the ceiling scribe) minus the top panel
    const gap = (interior - 3 * T) / 4;
    expect(shelves[0]!.bounds.y).toBe(Math.round((layout.carcass.y + gap) / inches(1 / 32)) * inches(1 / 32));
  });

  it('an open top drops the top panel and rail so the opening runs to the carcass top', () => {
    const { run, result } = setup((_, r) => {
      boxesOf(tier(r, 0))[0]!.overrides = { carcass: { top: 'open' } };
    });
    const id = boxesOf(tier(run, 0))[0]!.id;
    const ids = result.parts.map((p) => p.id);
    expect(ids).not.toContain(`${id}/top`);
    expect(ids).not.toContain(`${id}/rail-top`);
    const b = result.boxes.find((bx) => bx.id === id)!;
    const r = b.sections[0]!.rect;
    expect(r.y + r.height).toBe(b.carcass.y + b.carcass.height);
  });

  it('partial overlay fronts stop half a reveal short of an open edge', () => {
    const { run, result } = setup((_, r) => {
      tier(r, 0).overrides = { carcass: { bottom: 'open' } };
    });
    const op = boxesOf(tier(run, 0))[0]!.content;
    const door = part(result, `${op.id}/door-left`);
    expect(door.bounds.y).toBe(inches(3.5 + 1 / 32));
    // The top still overlays the top rail by 1/2".
    expect(door.bounds.y + door.bounds.height).toBe(inches(30 - 1.5 + 0.5));
  });
});

describe('deriveRun: exposed bottoms', () => {
  const overGap = (more?: (r: Run) => void) =>
    setup((_, r) => {
      const id = newId();
      r.spans.push({ id, kind: 'gap', x: { anchor: 'center', offset: 0 }, width: inches(36), tiers: { from: tier(r, 0).id, to: tier(r, 0).id }, content: opening() });
      tier(r, 0).items.splice(2, 0, { kind: 'slot', spanId: id });
      more?.(r);
    });

  it('adds a finished bottom flush with the rail under boxes over a gap', () => {
    const { run, result } = overGap();
    const [u0, u1, u2, u3] = boxesOf(tier(run, 1)).map((b) => b.id);
    const finished = result.parts.filter((p) => p.name === 'Finished bottom').map((p) => p.ownerId);
    expect(finished).toEqual([u1, u2]);
    const fb = part(result, `${u1}/bottom-finish`);
    expect(fb.bounds).toMatchObject({ x: inches(30.25) + T, y: inches(30), height: T, z: TB, depth: inches(12) - TB });
    // The interior bottom stays flush with the top of the rail.
    expect(part(result, `${u1}/bottom`).bounds.y).toBe(inches(31.5) - T);
    void u0;
    void u3;
  });

  it('drops a single bottom panel flush when the rail is too narrow for two', () => {
    const { run, result } = overGap((r) => {
      tier(r, 1).overrides = { faceFrame: { bottomRailWidth: inches(1) } };
    });
    const u1 = boxesOf(tier(run, 1))[1]!.id;
    expect(result.parts.some((p) => p.id === `${u1}/bottom-finish`)).toBe(false);
    expect(part(result, `${u1}/bottom`).bounds.y).toBe(inches(30));
  });

  it('leaves boxes that rest on other boxes alone', () => {
    expect(setup().result.parts.filter((p) => p.name === 'Finished bottom')).toEqual([]);
    expect(setup().result.parts.filter((p) => p.role === 'filler')).toEqual([]);
  });

  it('fills the wall scribe space under a box over an opening that runs to the wall', () => {
    // A doorway at the right end of the base tier: the upper box above it sits 1/2" off the
    // right wall with nothing below that space.
    const { run, result } = setup((_, r) => {
      const id = newId();
      r.spans.push({ id, kind: 'gap', x: { anchor: 'right', offset: 0 }, width: inches(30), tiers: { from: tier(r, 0).id, to: tier(r, 0).id }, content: opening() });
      tier(r, 0).items.push({ kind: 'slot', spanId: id });
    });
    const upperRight = boxesOf(tier(run, 1)).at(-1)!.id;
    const strips = result.parts.filter((p) => p.role === 'filler');
    expect(strips.map((p) => p.id)).toEqual([`${upperRight}/scribe-strip-right`]);
    const strip = strips[0]!;
    expect(strip.bounds).toEqual({ x: inches(119.5), y: inches(30), z: 0, width: inches(0.5), height: inches(0.75), depth: inches(12) });
    expect([strip.length, strip.width, strip.thickness]).toEqual([inches(12), inches(0.5), inches(0.75)]);
    expect(strip.materialId).toBe('poplar-3-4');
  });

  it('needs no scribe strip where a countertop runs to the wall below', () => {
    const { result } = setup((_, r) => {
      tier(r, 0).countertop = { thickness: inches(1.5), frontOverhang: inches(1), endOverhang: inches(1) };
    });
    expect(result.parts.filter((p) => p.role === 'filler')).toEqual([]);
  });
});

describe('deriveRun: drawer boxes', () => {
  const T2 = inches(15 / 32); // default drawer box plywood
  const withDrawer = (depth?: number) =>
    setup((_, r) => {
      if (depth) tier(r, 0).depth = inches(depth);
      boxesOf(tier(r, 0))[0]!.content = opening({ type: 'drawer' });
    });
  const drawerParts = (r: RunResult, opId: string) => r.parts.filter((p) => p.id.startsWith(`${opId}/`) && (p.role === 'drawerBox' || p.role === 'drawerBottom'));

  it('sizes a box on side-mount slides from the opening, with the longest slide that fits', () => {
    const { run, result } = withDrawer();
    const op = boxesOf(tier(run, 0))[0]!.content;
    expect(nonInfo(result)).toEqual([]);
    const parts = drawerParts(result, op.id);
    expect(parts.map((p) => p.name).sort()).toEqual(['Drawer bottom', 'Drawer box back', 'Drawer box front', 'Drawer side', 'Drawer side']);
    const side = parts.find((p) => p.id.endsWith('-side-left'))!;
    // 16" slide (the opening has 16 1/32" in front of the back after 1/2" rear clearance).
    expect([side.length, side.width, side.thickness]).toEqual([inches(16), inches(22.5), T2]);
    const front = parts.find((p) => p.id.endsWith('-box-front'))!;
    // 28 5/16" clear opening − 2 × 1/2" slide clearance = 27 5/16" box, front between the sides.
    expect([front.length, front.width]).toEqual([inches(27 + 5 / 16) - 2 * T2, inches(22.5)]);
    // The box front sits against the back of the overlay drawer front.
    const df = result.parts.find((p) => p.id === `${op.id}/drawer-front`)!;
    expect(front.bounds.z + front.bounds.depth).toBe(df.bounds.z);
    const bottom = parts.find((p) => p.role === 'drawerBottom')!;
    expect([bottom.length, bottom.width, bottom.thickness]).toEqual([inches(26 + 27 / 32), inches(15 + 17 / 32), inches(7 / 32)]);
  });

  it('warns when no slide fits', () => {
    const { result } = withDrawer(9);
    expect(result.issues.map((i) => i.code)).toContain('drawer-too-shallow');
    expect(result.parts.some((p) => p.role === 'drawerBox')).toBe(false);
  });
});

describe('deriveRun: five-piece fronts', () => {
  it('builds doors from stiles, rails with stub tenons and a floating panel', () => {
    const { run, result } = setup((p) => {
      p.settings = { ...p.settings, fronts: { ...p.settings.fronts, doorStyle: 'fivePiece' } };
    });
    expect(nonInfo(result)).toEqual([]);
    expect(result.parts.some((p) => p.role === 'door')).toBe(false);
    const op = boxesOf(tier(run, 0))[0]!.content;
    const piece = (suffix: string) => part(result, `${op.id}/door-left-${suffix}`);
    const doorW = inches(14 + 19 / 32);
    const stile = piece('stile-left');
    expect([stile.length, stile.width, stile.thickness, stile.role]).toEqual([inches(24.5), inches(2.25), inches(0.75), 'frontFrame']);
    const rail = piece('rail-top');
    expect([rail.length, rail.width]).toEqual([doorW - inches(4.5) + inches(0.75), inches(2.25)]);
    const panel = piece('panel');
    // Panel fills the grooves (3/8" deep) less 1/16" clearance per side, grain vertical.
    expect([panel.length, panel.width, panel.thickness, panel.role]).toEqual([inches(20 + 5 / 8), doorW - inches(4.5) + inches(5 / 8), inches(7 / 32), 'frontPanel']);
    // The door's outline matches a slab door's.
    expect(stile.bounds.z).toBe(inches(16.75));
    expect(piece('stile-right').bounds.x + inches(2.25) - stile.bounds.x).toBe(doorW);
  });

  it('falls back to a slab when a front is too small for a frame', () => {
    const { run, result } = setup((p, r) => {
      p.settings = { ...p.settings, fronts: { ...p.settings.fronts, drawerStyle: 'fivePiece' } };
      const s: Split = {
        kind: 'split',
        id: newId(),
        direction: 'rows',
        divider: 'frameOnly',
        children: [
          { size: { kind: 'fixed', size: inches(3) }, section: opening({ type: 'drawer' }) },
          { size: { kind: 'flex', ratio: 1 }, section: opening({ type: 'doorPair' }, 1) },
        ],
      };
      boxesOf(tier(r, 0))[0]!.content = s;
    });
    expect(result.issues.map((i) => i.code)).toContain('front-too-small-for-five-piece');
    expect(result.parts.some((p) => p.role === 'drawerFront')).toBe(true);
    void run;
  });
});
