import { describe, expect, it } from 'vitest';
import { describeBandedEdges, type Part, type RunResult } from '../derived';
import { createDefaultProject, flexBox, newId, opening } from '../defaults';
import type { Box, Opening, Project, Run, Span, Split, Tier } from '../model';
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
/** Issues other than exposed raw edge notes (tested on their own). */
const notRawEdges = (r: RunResult) => r.issues.filter((i) => i.code !== 'raw-edges');
/** Problems other than parts too big for stock (some layouts here use wide boxes on purpose). */
const layoutProblems = (r: RunResult) => nonInfo(r).filter((i) => i.code !== 'part-exceeds-stock');
const counters = (r: RunResult) => r.parts.filter((p) => p.role === 'countertop');

/** Add a span (tall box or gap) with a slot in each tier it passes through. */
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

describe('deriveRun: default project', () => {
  const { run, result } = setup();
  const base = tier(run, 0);
  const upper = tier(run, 1);

  it('has no problems', () => {
    expect(notRawEdges(result)).toEqual([]);
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
    const fronts = kick.filter((p) => p.name === 'Toe kick (front)');
    const backs = kick.filter((p) => p.name === 'Toe kick (back)');
    // The front board runs wall to wall; the platform behind it sits under the carcasses. Boards
    // longer than a 96" sheet are pieced, joined over the cross piece under a box joint.
    expect(fronts.map((p) => [p.bounds.x, p.bounds.x + p.bounds.width])).toEqual([
      [0, inches(89.75)],
      [inches(89.75), inches(120)],
    ]);
    expect(backs.map((p) => p.length)).toEqual([inches(89.25), inches(29.75)]);
    expect(fronts[0]!.note).toBe('Piece 1 of 2; joints fall on cross pieces');
    const front = fronts[0]!;
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
    const fronts = result.parts.filter((p) => p.name === 'Toe kick (front)');
    expect(fronts.reduce((n, p) => n + p.bounds.width, 0)).toBe(inches(120));
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
      expect(notRawEdges(result)).toEqual([]);
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
      expect(notRawEdges(result)).toEqual([]);
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
      expect(layoutProblems(aligned)).toEqual([]);
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
    expect(layoutProblems(result)).toEqual([]);
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

  it('continues over a gap marked to bridge it, e.g. a desk over knee space', () => {
    const { result } = withCounter((_, r) => {
      const id = newId();
      r.spans.push({ id, kind: 'gap', name: 'Knee space', bridgeCountertop: true, x: { anchor: 'center', offset: 0 }, width: inches(36), tiers: { from: tier(r, 0).id, to: tier(r, 0).id }, content: opening() });
      tier(r, 0).items.splice(2, 0, { kind: 'slot', spanId: id });
    });
    expect(counters(result).map((c) => [c.bounds.x, c.bounds.x + c.bounds.width])).toEqual([[0, inches(120)]]);
    // A 1 1/2" hardwood top over 36" is stiff enough.
    expect(result.issues.some((i) => i.code === 'shelf-sag')).toBe(false);
  });

  it('flags a thin countertop sagging over a wide bridged gap', () => {
    const { result } = withCounter((_, r) => {
      tier(r, 0).countertop = { ...CT, thickness: inches(3 / 4) };
      const id = newId();
      r.spans.push({ id, kind: 'gap', name: 'Desk', bridgeCountertop: true, x: { anchor: 'center', offset: 0 }, width: inches(60), tiers: { from: tier(r, 0).id, to: tier(r, 0).id }, content: opening() });
      tier(r, 0).items = [flexBox(opening({ type: 'doorPair' }, 1)), { kind: 'slot', spanId: id }, flexBox(opening({ type: 'doorPair' }, 1))];
    });
    const sag = result.issues.find((i) => i.code === 'shelf-sag')!;
    expect(sag.message).toContain('"Desk"');
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

  it('sizes the box for the chosen slides (undermount: tighter sides, its own lengths)', () => {
    const { run, result } = setup((p, r) => {
      p.settings = { ...p.settings, hardware: { ...p.settings.hardware, slide: 'slide-under-full' } };
      boxesOf(tier(r, 0))[0]!.content = opening({ type: 'drawer' });
    });
    const op = boxesOf(tier(run, 0))[0]!.content;
    const side = drawerParts(result, op.id).find((p) => p.id.endsWith('-side-left'))!;
    expect(side.length).toBe(inches(15));
    const front = drawerParts(result, op.id).find((p) => p.id.endsWith('-box-front'))!;
    expect(front.length).toBe(inches(27 + 15 / 16) - 2 * T2);
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

describe('deriveRun: frameless construction', () => {
  const frameless = (more?: (p: Project, r: Run) => void) =>
    setup((p, r) => {
      p.settings = { ...p.settings, construction: 'frameless', fronts: { ...p.settings.fronts, mounting: 'fullOverlay' } };
      more?.(p, r);
    });

  it('has no face frame; full overlay fronts sit on the carcass edges', () => {
    const { run, result } = frameless();
    expect(notRawEdges(result)).toEqual([]);
    expect(result.parts.filter((p) => p.role === 'stile' || p.role === 'rail')).toEqual([]);
    expect(result.frames).toEqual([]);
    const b0 = boxesOf(tier(run, 0))[0]!;
    const door = part(result, `${b0.content.id}/door-left`);
    // 29 3/4" box: the pair covers the carcass less half a reveal at each outer edge.
    expect([door.width, door.length]).toEqual([inches(14 + 25 / 32), inches(26 + 7 / 16)]);
    expect(door.bounds.z).toBe(inches(16));
    expect(door.bounds.x).toBe(inches(0.5 + 1 / 32));
    // Bottom panel flush with the carcass bottom.
    expect(part(result, `${b0.id}/bottom`).bounds.y).toBe(inches(3.5));
    // Toe kick face 3" back from the carcass front.
    const kick = result.parts.find((p) => p.name === 'Toe kick (front)')!;
    expect(kick.bounds.z + kick.bounds.depth).toBe(inches(13));
  });

  it('closes the scribe space at each wall with a filler in the plane of the fronts', () => {
    const { result } = frameless();
    const fillers = result.parts.filter((p) => p.name === 'Wall filler');
    // One per wall end for each tier.
    expect(fillers).toHaveLength(4);
    const left = fillers.find((p) => p.bounds.x === 0)!;
    expect(left.bounds).toMatchObject({ width: inches(0.5), z: inches(16), depth: T });
  });

  it('stacks frameless drawers with only the reveal between their fronts', () => {
    const { run, result } = frameless((_, r) => {
      boxesOf(tier(r, 0))[0]!.content = {
        kind: 'split',
        id: newId(),
        direction: 'rows',
        divider: 'frameOnly',
        children: [0, 1].map(() => ({ size: { kind: 'flex' as const, ratio: 1 }, section: opening({ type: 'drawer' }) })),
      };
    });
    expect(nonInfo(result)).toEqual([]);
    const split = boxesOf(tier(run, 0))[0]!.content as Split;
    const [upper, lower] = split.children.map((c) => part(result, `${c.section.id}/drawer-front`));
    expect(upper!.bounds.y - (lower!.bounds.y + lower!.bounds.height)).toBe(inches(1 / 16));
    expect(result.parts.some((p) => p.role === 'fixedShelf')).toBe(false);
  });
});

describe('deriveRun: joinery presets', () => {
  it('cuts captured parts longer by the dado depth at each end and says why', () => {
    let split!: Split;
    const { run, result } = setup((p, r) => {
      p.settings = { ...p.settings, joinery: 'dado', joineryDepth: inches(1 / 4) };
      split = {
        kind: 'split',
        id: newId(),
        direction: 'columns',
        divider: 'panel',
        children: [0, 1].map(() => ({ size: { kind: 'flex' as const, ratio: 1 }, section: opening() })),
      };
      tier(r, 1).items[0] = flexBox(split);
    });
    const b0 = boxesOf(tier(run, 0))[0]!.id;
    const top = part(result, `${b0}/top`);
    expect(top.length).toBe(inches(29.75) - 2 * T + inches(0.5));
    expect(top.note).toBe('+1/4" each end into dados');
    // Visible geometry is unchanged: the panel still spans between the sides.
    expect(top.bounds.width).toBe(inches(29.75) - 2 * T);
    const partition = part(result, `${split.id}/partition-0`);
    expect(partition.length).toBe(partition.bounds.height + inches(0.5));
  });

  it('leaves sizes alone for butt, dowel and confirmat joints', () => {
    const sizes = (joinery: 'butt' | 'dowel' | 'confirmat') => {
      const { run, result } = setup((p) => {
        p.settings = { ...p.settings, joinery };
      });
      const top = part(result, `${boxesOf(tier(run, 0))[0]!.id}/top`);
      return [top.length, top.note];
    };
    expect(sizes('dowel')).toEqual(sizes('butt'));
    expect(sizes('confirmat')).toEqual([inches(29.75) - 2 * T, undefined]);
  });
});

describe('deriveRun: measured irregularity', () => {
  it('fits boxes to the tightest length and cuts scribe stiles wide enough for the widest', () => {
    const { run, result } = setup((_, r) => {
      r.wall[0]!.measuredLengths = [inches(119.5), inches(120.25)];
    });
    expect(result.width).toBe(inches(119.5));
    const note = result.issues.find((i) => i.code === 'wall-varies')!;
    expect(note.severity).toBe('info');
    expect(note.message).toContain('3/4"');
    const left = part(result, `${boxesOf(tier(run, 0))[0]!.id}/stile-left`);
    expect(left.name).toBe('Scribe stile');
    expect(left.width).toBe(left.bounds.width + inches(0.75));
    expect(left.note).toBe('+3/4" wide to scribe to the wall');
  });

  it('warns when the variance is more than the scribe allowance can take up', () => {
    const { result } = setup((_, r) => {
      r.wall[0]!.measuredLengths = [inches(118.5)];
    });
    expect(result.issues.find((i) => i.code === 'wall-varies')!.severity).toBe('warning');
  });

  it('fits tiers under the lowest ceiling measurement', () => {
    const { result } = setup((_, r) => {
      r.wall[0]!.measuredCeilings = [inches(95.5), inches(96.25)];
    });
    expect(result.ceilingHeight).toBe(inches(95.5));
    expect(result.tiers[1]!.height).toBe(inches(65));
    expect(result.issues.map((i) => i.code)).toContain('ceiling-varies');
  });
});

describe('deriveRun: moldings', () => {
  const CROWN = { height: inches(3.5), projection: inches(2.5) };

  it('runs crown wall to wall along the top tier, up against the ceiling', () => {
    const { result } = setup((_, r) => {
      r.trim = { crown: CROWN };
    });
    const crown = result.parts.filter((p) => p.role === 'molding');
    expect(crown.map((p) => p.name)).toEqual(['Crown']);
    expect(crown[0]!.bounds).toEqual({ x: 0, y: inches(92.5), z: inches(12.75), width: inches(120), height: inches(3.5), depth: inches(2.5) });
    expect(crown[0]!.length).toBe(inches(120));
  });

  it('returns along the side at an open end', () => {
    const { result } = setup((_, r) => {
      r.trim = { crown: CROWN };
      r.ends.right = 'open';
    });
    const front = result.parts.find((p) => p.name === 'Crown')!;
    const ret = result.parts.find((p) => p.name === 'Crown return')!;
    // Open right end: the boxes reach the end of the run; the front miters around the corner.
    expect(front.bounds.x + front.bounds.width).toBe(inches(120 + 2.5));
    // The return runs from the wall to the outside corner, where the two meet in a 45° miter.
    expect(ret.bounds).toMatchObject({ x: inches(120), z: 0, depth: inches(12.75 + 2.5), width: inches(2.5) });
    expect(ret.length).toBe(inches(12.75 + 2.5));
    expect(front.mitres).toEqual([{ face: 'right', outer: 'front' }]);
    expect(ret.mitres).toEqual([{ face: 'front', outer: 'right' }]);
  });

  it('puts base molding at the floor, against the face of the frame', () => {
    const base = { height: inches(3.5), projection: inches(0.75) };
    const noKick = setup((_, r) => {
      r.trim = { base };
      delete tier(r, 0).toeKick;
    }).result;
    const m = noKick.parts.find((p) => p.name === 'Base molding')!;
    expect(m.bounds).toMatchObject({ y: 0, z: inches(16.75), height: inches(3.5), depth: inches(0.75) });
  });

  it('covers a flush toe kick, so the platform still levels the boxes', () => {
    const { run, result } = setup((_, r) => {
      r.trim = { base: { height: inches(4), projection: inches(0.75) } };
      tier(r, 0).toeKick = { height: inches(3.5), setback: 0 };
    });
    const m = result.parts.find((p) => p.name === 'Base molding')!;
    const kick = result.parts.find((p) => p.ownerId === tier(run, 0).id && p.id.includes('/kick-0-front'))!;
    // Its back sits on the kick board's face, which is flush with the frame.
    expect(m.bounds.y).toBe(0);
    expect(m.bounds.z).toBe(kick.bounds.z + kick.bounds.depth);
    expect(m.bounds.z).toBe(inches(16.75));
    expect(result.issues.map((i) => i.code)).not.toContain('base-molding-recess');
    expect(result.issues.map((i) => i.code)).not.toContain('base-molding-tall');
  });

  it('notes a set-back kick behind the molding, and warns when it would cover the doors', () => {
    const setBack = setup((_, r) => {
      r.trim = { base: { height: inches(3.5), projection: inches(0.75) } };
    }).result;
    expect(setBack.issues.find((i) => i.code === 'base-molding-recess')!.message).toMatch(/set back 3"/);
    // Doors start 4 1/2" up (3 1/2" kick + 1 1/2" rail − 1/2" overlay): a 6" molding covers them.
    const tall = setup((_, r) => {
      r.trim = { base: { height: inches(6), projection: inches(1) } };
      tier(r, 0).toeKick = { height: inches(3.5), setback: 0 };
    }).result;
    const warning = tall.issues.find((i) => i.code === 'base-molding-tall')!;
    expect(warning.severity).toBe('warning');
    expect(warning.message).toMatch(/fronts start 4 1\/2" above the floor/);
  });
});

describe('deriveRun: edge banding', () => {
  const banded = (thickness: number, more?: (p: Project) => void) =>
    setup((p) => {
      p.settings = { ...p.settings, edgeBanding: { enabled: true, thickness } };
      more?.(p);
    });

  it("names the banded faces: a shelf's front edge, all four edges of a slab door", () => {
    const { run, result } = banded(0, (p) => {
      p.settings = { ...p.settings, construction: 'frameless' };
    });
    const op = boxesOf(tier(run, 0))[0]!.content.id;
    expect(part(result, `${op}/door-left`).bandedEdges).toEqual(['left', 'right', 'bottom', 'top']);
    const upper = boxesOf(tier(run, 1))[0]!;
    expect(part(result, `${upper.content.id}/adj-shelf-0`).bandedEdges).toEqual(['front']);
    // Frameless: the carcass front edges too; face frame boxes cover them with the frame.
    expect(part(result, `${upper.id}/side-left`).bandedEdges).toEqual(['front']);
    const faceFrame = setup();
    expect(part(faceFrame.result, `${boxesOf(tier(faceFrame.run, 1))[0]!.id}/side-left`).bandedEdges).toBeUndefined();
    expect(describeBandedEdges(['front'])).toBe('Front edge');
    expect(describeBandedEdges(['left', 'right', 'bottom', 'top'])).toBe('All 4 edges');
  });

  it('records banded edges, and cuts parts smaller by solid edging thickness', () => {
    const veneer = banded(0);
    const solid = banded(inches(1 / 4));
    const op = boxesOf(tier(veneer.run, 0))[0]!.content.id;
    const opSolid = boxesOf(tier(solid.run, 0))[0]!.content.id;
    const door = part(veneer.result, `${op}/door-left`);
    expect(door.banding).toBe(2 * (door.length + door.width));
    expect(door.note).toBe('Band all four edges');
    const doorSolid = part(solid.result, `${opSolid}/door-left`);
    expect([doorSolid.length, doorSolid.width]).toEqual([door.length - inches(0.5), door.width - inches(0.5)]);
    const shelf = part(veneer.result, `${op}/adj-shelf-0`);
    const shelfSolid = part(solid.result, `${opSolid}/adj-shelf-0`);
    expect(shelf.banding).toBe(shelf.length);
    expect(shelfSolid.width).toBe(shelf.width - inches(0.25));
    // Face-frame carcass edges are covered by the frame, so they aren't banded.
    expect(part(veneer.result, `${boxesOf(tier(veneer.run, 0))[0]!.id}/side-left`).banding).toBeUndefined();
  });

  it('bands frameless carcass front edges and can be turned off', () => {
    const fl = banded(0, (p) => {
      p.settings = { ...p.settings, construction: 'frameless' };
    });
    expect(part(fl.result, `${boxesOf(tier(fl.run, 0))[0]!.id}/side-left`).banding).toBe(inches(26.5));
    const off = setup((p) => {
      p.settings = { ...p.settings, edgeBanding: { enabled: false, thickness: 0 } };
    });
    expect(off.result.parts.some((p) => p.banding !== undefined)).toBe(false);
  });
});

describe('deriveRun: machining', () => {
  it('drills shelf pin rows on the faces that hold adjustable shelves', () => {
    const { run, result } = setup();
    const box = boxesOf(tier(run, 1))[0]!; // open upper box with 3 adjustable shelves
    const side = part(result, `${box.id}/side-left`);
    const holes = side.features!;
    expect(holes.every((h) => h.label === 'Shelf pin' && h.axis === 'x' && h.diameter === mm(5))).toBe(true);
    // Drilled on the side's inside face, in a front and a back row.
    expect(new Set(holes.map((h) => h.x))).toEqual(new Set([side.bounds.x + side.bounds.width]));
    const rows = [...new Set(holes.map((h) => h.z))];
    expect(rows).toEqual([side.bounds.z + inches(1.5), side.bounds.z + side.bounds.depth - inches(1.5)]);
    // 32 mm apart, at least 4" from the opening's top and bottom.
    const ys = [...new Set(holes.map((h) => h.y))].sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBe(mm(32));
    expect(ys[0]).toBe(inches(31.5 + 4));
    expect(ys.at(-1)!).toBeLessThanOrEqual(inches(95.5) - T - inches(4));
    expect(part(result, `${box.id}/side-right`).features).toHaveLength(holes.length);
  });

  it('bores 35 mm hinge cups along the hinge edge of each door', () => {
    const { run, result } = setup();
    const op = boxesOf(tier(run, 0))[0]!.content.id;
    const left = part(result, `${op}/door-left`);
    const cups = left.features!;
    expect(cups.map((c) => c.label)).toEqual(['Hinge cup', 'Hinge cup']);
    expect(cups.map((c) => c.y)).toEqual([left.bounds.y + inches(3), left.bounds.y + left.bounds.height - inches(3)]);
    expect(cups.every((c) => c.x === left.bounds.x + mm(22.5) && c.z === left.bounds.z && c.diameter === mm(35))).toBe(true);
    const right = part(result, `${op}/door-right`);
    expect(right.features!.every((c) => c.x === right.bounds.x + right.bounds.width - mm(22.5))).toBe(true);
  });

  it('skips cups for butt hinges', () => {
    const { run, result } = setup((p) => {
      p.settings = { ...p.settings, hardware: { ...p.settings.hardware, hinge: 'hinge-butt' } };
    });
    const op = boxesOf(tier(run, 0))[0]!.content.id;
    expect(part(result, `${op}/door-left`).features).toBeUndefined();
  });
});

describe('deriveRun: hardware for illustration', () => {
  const boxOf = (b: { bounds: { x: number; y: number; z: number; width: number; height: number; depth: number } }) => b.bounds;
  const shapeBox = (h: RunResult['hardware'][number], i = 0) => {
    const sh = h.shapes[i]!;
    if (sh.kind !== 'box') throw new Error('expected a box');
    return sh.bounds;
  };

  it('puts a side-mount slide in the clearance on each side of a drawer box', () => {
    const { run, result } = setup((_, r) => {
      boxesOf(tier(r, 0))[0]!.content = opening({ type: 'drawer' });
    });
    const op = boxesOf(tier(run, 0))[0]!.content.id;
    const slides = result.hardware.filter((h) => h.kind === 'drawerSlide');
    expect(slides.map((h) => h.id)).toEqual([`${op}/drawer-side-left/slide`, `${op}/drawer-side-right/slide`]);
    const left = boxOf(part(result, `${op}/drawer-side-left`));
    const right = boxOf(part(result, `${op}/drawer-side-right`));
    const sl = shapeBox(slides[0]!);
    const sr = shapeBox(slides[1]!);
    // 1/2" slides against the outside of each drawer side, as long as the box (less 2 mm at the front).
    expect([sl.x + sl.width, sl.width, sl.z, sl.depth]).toEqual([left.x, inches(1 / 2), left.z, left.depth - mm(2)]);
    expect([sr.x, sr.width]).toEqual([right.x + right.width, inches(1 / 2)]);
    // Centered on the side's height.
    expect(sl.y + sl.height / 2).toBe(left.y + left.height / 2);
    expect(slides[0]!.partId).toBe(`${op}/drawer-side-left`);
    expect(slides[0]!.typeId).toBe('slide-side-ball');
  });

  it('puts undermount runners under the drawer bottom', () => {
    const { run, result } = setup((p, r) => {
      p.settings = { ...p.settings, hardware: { ...p.settings.hardware, slide: 'slide-under-full' } };
      boxesOf(tier(r, 0))[0]!.content = opening({ type: 'drawer' });
    });
    const op = boxesOf(tier(run, 0))[0]!.content.id;
    const bottom = boxOf(part(result, `${op}/drawer-bottom`));
    const side = boxOf(part(result, `${op}/drawer-side-left`));
    const runner = shapeBox(result.hardware.find((h) => h.kind === 'drawerSlide')!);
    expect(runner.y + runner.height).toBeLessThan(bottom.y);
    expect(runner.y).toBeLessThan(side.y);
    // Under the drawer side and into the recess beside it.
    expect(runner.x).toBeLessThan(side.x);
    expect(runner.x + runner.width).toBeGreaterThan(side.x + side.width);
  });

  it('places a concealed hinge at each cup, with its arm running back into the box', () => {
    const { run, result } = setup();
    const op = boxesOf(tier(run, 0))[0]!.content.id;
    const door = part(result, `${op}/door-left`);
    const hinges = result.hardware.filter((h) => h.partId === door.id);
    expect(hinges.map((h) => h.kind)).toEqual(['hinge', 'hinge']);
    hinges.forEach((h, k) => {
      const cup = h.shapes[0]!;
      const hole = door.features![k]!;
      expect(cup).toMatchObject({ kind: 'cylinder', axis: 'z', x: hole.x, y: hole.y, diameter: mm(35) });
      const arm = shapeBox(h, 1);
      // From behind the frame forward to the door's back face.
      expect(arm.z + arm.depth).toBe(door.bounds.z);
      expect(arm.z).toBeLessThan(door.bounds.z - inches(3 / 4));
    });
  });

  it('places butt hinge knuckles on the hinge edge', () => {
    const { run, result } = setup((p) => {
      p.settings = { ...p.settings, hardware: { ...p.settings.hardware, hinge: 'hinge-butt' } };
    });
    const op = boxesOf(tier(run, 0))[0]!.content.id;
    const door = part(result, `${op}/door-right`);
    const knuckles = result.hardware.filter((h) => h.partId === door.id).map((h) => h.shapes[0]!);
    expect(knuckles).toHaveLength(2);
    expect(knuckles.every((k) => k.kind === 'cylinder' && k.axis === 'y' && k.x === door.bounds.x + door.bounds.width)).toBe(true);
  });

  it('puts four pins under each adjustable shelf', () => {
    const { run, result } = setup();
    const box = boxesOf(tier(run, 1))[0]!; // open upper box with 3 adjustable shelves
    const shelves = result.parts.filter((p) => p.ownerId === box.id && p.role === 'adjustableShelf');
    const pins = result.hardware.filter((h) => h.ownerId === box.id && h.kind === 'shelfPin');
    expect(pins).toHaveLength(2 * shelves.length);
    for (const shelf of shelves) {
      const under = pins.filter((h) => h.id.startsWith(`${shelf.id}/`)).flatMap((h) => h.shapes);
      expect(under).toHaveLength(4);
      for (const pin of under) {
        if (pin.kind !== 'cylinder') throw new Error('expected a cylinder');
        // Touching the shelf's underside.
        expect(pin.y + pin.diameter / 2).toBe(shelf.bounds.y);
        expect(pin.axis).toBe('x');
      }
    }
    // Each row of pins sits in the side's pin holes' rows.
    const side = part(result, `${box.id}/side-left`);
    const leftPins = pins.filter((h) => h.partId === side.id).flatMap((h) => h.shapes);
    expect(new Set(leftPins.map((p) => (p.kind === 'cylinder' ? p.z : 0)))).toEqual(new Set(side.features!.map((f) => f.z)));
  });
});

describe('deriveRun: fixed shelves', () => {
  const withFixed = (mutate?: (p: Project, r: Run) => void, fixed = 1) =>
    setup((p, r) => {
      const op = boxesOf(tier(r, 1))[0]!.content; // open upper box, 3 adjustable shelves
      if (op.kind === 'opening') op.fixedShelves = fixed;
      mutate?.(p, r);
    });
  const shelvesOf = (r: RunResult, opId: string, role: Part['role']) => r.parts.filter((p) => p.id.startsWith(`${opId}/`) && p.role === role);

  it('adds a fixed shelf with a flush rail over its front edge', () => {
    const { run, result } = withFixed();
    const box = boxesOf(tier(run, 1))[0]!;
    expect(nonInfo(result)).toEqual([]);
    const fixed = shelvesOf(result, box.content.id, 'fixedShelf');
    const rails = result.parts.filter((p) => p.id.startsWith(`${box.content.id}/shelf-rail`));
    expect(fixed).toHaveLength(1);
    expect(rails).toHaveLength(1);
    const [shelf, rail] = [fixed[0]!, rails[0]!];
    const side = part(result, `${box.id}/side-left`);
    // The rail sits in the face frame (flush), and its top is flush with the shelf top.
    const topRail = part(result, `${box.id}/rail-top`);
    expect(rail.bounds.z).toBe(topRail.bounds.z);
    expect(rail.bounds.y + rail.bounds.height).toBe(shelf.bounds.y + shelf.bounds.height);
    // The shelf spans the interior, captured in the sides, and runs to the back of the frame.
    expect(shelf.bounds.x).toBe(side.bounds.x + side.bounds.width);
    expect(shelf.bounds.z + shelf.bounds.depth).toBe(topRail.bounds.z);
    // Three adjustable shelves in each space, above and below.
    const adj = shelvesOf(result, box.content.id, 'adjustableShelf');
    expect(adj).toHaveLength(6);
    expect(adj.filter((p) => p.bounds.y < shelf.bounds.y)).toHaveLength(3);
    // The face openings above and below the rail are the same height (to the grid).
    const bottomRail = part(result, `${box.id}/rail-bottom`);
    const lower = rail.bounds.y - (bottomRail.bounds.y + bottomRail.bounds.height);
    const upper = topRail.bounds.y - (rail.bounds.y + rail.bounds.height);
    expect(Math.abs(lower - upper)).toBeLessThanOrEqual(inches(1 / 32));
  });

  it('sets the rail and shelf back when the edge is inset', () => {
    const { run, result } = withFixed((p) => {
      p.settings = { ...p.settings, shelves: { ...p.settings.shelves, fixedEdge: 'inset', fixedSetback: inches(1 / 4) } };
    });
    const box = boxesOf(tier(run, 1))[0]!;
    const rail = part(result, `${box.content.id}/shelf-rail-0`);
    const shelf = part(result, `${box.content.id}/fixed-shelf-0`);
    const topRail = part(result, `${box.id}/rail-top`);
    expect(rail.bounds.z + rail.bounds.depth).toBe(topRail.bounds.z + topRail.bounds.depth - inches(1 / 4));
    expect(shelf.bounds.z + shelf.bounds.depth).toBe(rail.bounds.z);
    expect(rail.note).toMatch(/Set back 1\/4"/);
  });

  it('keeps the rail behind an inset door', () => {
    const { run, result } = setup((p, r) => {
      p.settings = { ...p.settings, fronts: { ...p.settings.fronts, mounting: 'inset' } };
      const op = boxesOf(tier(r, 0))[0]!.content; // base box with a door pair
      if (op.kind === 'opening') op.fixedShelves = 1;
    });
    const op = boxesOf(tier(run, 0))[0]!.content.id;
    const rail = part(result, `${op}/shelf-rail-0`);
    const door = part(result, `${op}/door-left`);
    expect(rail.bounds.z + rail.bounds.depth).toBeLessThanOrEqual(door.bounds.z - inches(1 / 16));
  });

  it('has no rail on a frameless box', () => {
    const { run, result } = withFixed((p) => {
      p.settings = { ...p.settings, construction: 'frameless' };
    }, 2);
    const box = boxesOf(tier(run, 1))[0]!;
    expect(shelvesOf(result, box.content.id, 'fixedShelf')).toHaveLength(2);
    expect(result.parts.some((p) => p.id.includes('/shelf-rail-'))).toBe(false);
    expect(shelvesOf(result, box.content.id, 'adjustableShelf')).toHaveLength(9);
  });

  it('ignores fixed shelves behind a drawer', () => {
    const { result } = setup((_, r) => {
      boxesOf(tier(r, 0))[0]!.content = { ...opening({ type: 'drawer' }), fixedShelves: 1 } as Opening;
    });
    expect(result.issues.map((i) => i.code)).toContain('shelves-in-drawer');
    expect(result.parts.some((p) => p.role === 'fixedShelf' && p.id.includes('fixed-shelf'))).toBe(false);
  });
});

describe('deriveRun: finishes', () => {
  const paintFrames = (p: Project) => {
    p.settings = { ...p.settings, finishes: { ...p.settings.finishes, faceFrame: 'paint-white' } };
  };

  it('paints the parts of a material slot, wherever that material is used', () => {
    const { result } = setup(paintFrames);
    const frames = result.parts.filter((p) => p.role === 'stile' || p.role === 'rail');
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((p) => p.finishId === 'paint-white')).toBe(true);
    // The same poplar elsewhere (5-piece frames) and the plywood carcass stay natural.
    expect(result.parts.filter((p) => p.role === 'side').every((p) => p.finishId === undefined)).toBe(true);
  });

  it('lets a box override back to natural, and tiers paint their toe kicks', () => {
    const { run, result } = setup((p, r) => {
      paintFrames(p);
      const b = boxesOf(tier(r, 0))[0]!;
      b.overrides = { finishes: { faceFrame: 'natural' } };
      tier(r, 0).overrides = { finishes: { toeKick: 'paint-black' } };
    });
    const b = boxesOf(tier(run, 0))[0]!;
    expect(part(result, `${b.id}/rail-top`).finishId).toBeUndefined();
    expect(part(result, `${boxesOf(tier(run, 0))[1]!.id}/rail-top`).finishId).toBe('paint-white');
    const kicks = result.parts.filter((p) => p.role === 'toeKick');
    expect(kicks.length).toBeGreaterThan(0);
    expect(kicks.every((p) => p.finishId === 'paint-black')).toBe(true);
  });
});

describe('deriveRun: splitting oversize parts', () => {
  /** One 146"-wide open base box (no doors), optionally three columns with partitions. */
  const wide = (opts: { split?: boolean; partitions?: boolean } = {}) =>
    setup((p, r) => {
      r.wall[0]!.length = inches(147);
      const base = tier(r, 0);
      const content: Split | Opening = opts.partitions
        ? { kind: 'split', id: newId(), direction: 'columns', divider: 'panel', children: [0, 1, 2].map(() => ({ size: { kind: 'flex' as const, ratio: 1 }, section: opening() })) }
        : (opening() as Opening);
      base.items = [{ kind: 'box', id: 'wide', width: { kind: 'fixed', size: inches(146) }, content }];
      r.tiers = [base];
      if (opts.split) p.settings = { ...p.settings, splitOversize: true };
    });
  const pieces = (r: RunResult, id: string) => r.parts.filter((p) => p.id.startsWith(`${id}-piece-`));
  const USABLE = inches(95.5); // 96" sheet less 1/4" trim each end
  const USABLE_W = inches(47.5);

  it('reports oversize parts when splitting is off', () => {
    const { result } = wide();
    const issue = result.issues.find((i) => i.code === 'part-exceeds-stock');
    expect(issue).toMatchObject({ severity: 'warning', sourceId: 'wide' });
    expect(issue!.message).toMatch(/Top, Bottom, Back and \d+ more are bigger than your stock/);
    expect(result.parts.some((p) => p.id.includes('-piece-'))).toBe(false);
  });

  it('pieces a top with an evenly placed (visible) joint when nothing can hide it', () => {
    const { result } = wide({ split: true });
    expect(result.issues.some((i) => i.code === 'part-exceeds-stock')).toBe(false);
    const top = pieces(result, 'wide/top');
    expect(top).toHaveLength(2);
    expect(top.every((p) => p.length <= USABLE)).toBe(true);
    expect(top[0]!.bounds.x + top[0]!.bounds.width).toBe(top[1]!.bounds.x);
    expect(top[0]!.note).toMatch(/One of 2 pieces; joint not hidden/);
    // The back's grain runs up, so its pieces are at most a sheet's width wide: 4 pieces.
    const back = pieces(result, 'wide/back');
    expect(back).toHaveLength(4);
    expect(back.every((p) => p.width <= USABLE_W)).toBe(true);
    // Lumber rails (146") are longer than a 12' board: two pieces.
    expect(pieces(result, 'wide/rail-top')).toHaveLength(2);
  });

  it('hides joints on partitions, and runs mid stiles through pieced rails', () => {
    const { result } = wide({ split: true, partitions: true });
    const partitions = result.parts.filter((p) => p.ownerId === 'wide' && p.role === 'partition');
    const centers = partitions.map((p) => p.bounds.x + p.bounds.width / 2);
    const top = pieces(result, 'wide/top');
    // Three pieces, every joint centered on a partition (no visible joints).
    expect(top).toHaveLength(3);
    expect(top.slice(0, -1).map((p) => p.bounds.x + p.bounds.width)).toEqual(centers);
    expect(top.every((p) => !/not hidden/.test(p.note ?? ''))).toBe(true);
    expect(top[0]!.note).toMatch(/joint centered on the partition/);
    // The top rail breaks at a mid stile, which now runs through it.
    const rail = pieces(result, 'wide/rail-top');
    expect(rail.length).toBeGreaterThanOrEqual(2);
    const stile = result.parts.find((p) => p.role === 'stile' && p.bounds.x === rail[0]!.bounds.x + rail[0]!.bounds.width)!;
    expect(stile).toBeDefined();
    expect(stile.bounds.y + stile.bounds.height).toBe(rail[0]!.bounds.y + rail[0]!.bounds.height);
    expect(stile.note).toMatch(/Runs through the rail/);
    expect(rail[1]!.bounds.x).toBe(stile.bounds.x + stile.bounds.width);
  });
});


describe('deriveRun: exposed raw edges', () => {
  it('flags the tops of base sides left bare on the ledge in front of shallower uppers', () => {
    const { run, result } = setup();
    const notes = result.issues.filter((i) => i.code === 'raw-edges');
    expect(notes.map((i) => i.sourceId).sort()).toEqual(boxesOf(tier(run, 0)).map((b) => b.id).sort());
    expect(notes[0]!.severity).toBe('info');
    const side = part(result, `${boxesOf(tier(run, 0))[0]!.id}/side-left`);
    // Only the top edge, only in front of the 12"-deep uppers (the box above hides the rest).
    expect(side.rawEdges!.map((e) => [e.face, e.axis])).toEqual([['top', 'z']]);
    const edge = side.rawEdges![0]!;
    expect(edge.from).toBeGreaterThanOrEqual(inches(12));
    expect(edge.to).toBe(side.bounds.z + side.bounds.depth);
    // Upper boxes: tops at the ceiling gap, everything else covered.
    expect(result.parts.filter((p) => p.rawEdges && p.ownerId === boxesOf(tier(run, 1))[0]!.id)).toEqual([]);
  });

  it('has nothing exposed under a countertop', () => {
    const { result } = setup((_, r) => {
      tier(r, 0).countertop = { thickness: inches(1.5), frontOverhang: inches(1), endOverhang: inches(1) };
    });
    expect(result.parts.filter((p) => p.rawEdges)).toEqual([]);
  });

  it('bands exposed edges when asked', () => {
    const { run, result } = setup((p) => {
      p.settings = { ...p.settings, edgeBanding: { ...p.settings.edgeBanding, exposed: true } };
    });
    expect(result.issues.some((i) => i.code === 'raw-edges')).toBe(false);
    const side = part(result, `${boxesOf(tier(run, 0))[0]!.id}/side-left`);
    expect(side.bandedEdges).toEqual(['top']);
    expect(side.banding).toBe(side.bounds.depth);
    expect(side.note).toMatch(/Band the exposed top edge/);
  });

  it('flags the bottom edges of a box over a doorway', () => {
    const { run, result } = setup((_, r) => {
      addSpan(r, { kind: 'gap', x: { anchor: 'center', offset: 0 }, width: inches(36), tiers: { from: tier(r, 0).id, to: tier(r, 0).id } }, () => 2);
    });
    const upper = boxesOf(tier(run, 1)).find((b) => {
      const c = result.boxes.find((x) => x.id === b.id)!.carcass;
      return c.x < inches(50) && c.x + c.width > inches(50);
    })!;
    const raw = result.parts.filter((p) => p.ownerId === upper.id && p.rawEdges?.some((e) => e.face === 'bottom'));
    expect(raw.map((p) => p.role)).toContain('back');
  });
});

describe('deriveRun: long moldings', () => {
  it('splices a crown longer than the longest stick over a stile, without a warning', () => {
    const { result } = setup((_, r) => {
      r.wall[0]!.length = inches(160);
      r.trim = { crown: { height: inches(3.5), projection: inches(2.5) } };
    });
    expect(result.issues.filter((i) => i.code === 'part-exceeds-stock')).toEqual([]);
    const crown = result.parts.filter((p) => p.role === 'molding' && p.id.includes('/crown-') && p.id.includes('-front'));
    expect(crown.length).toBe(2);
    expect(crown.every((p) => p.length <= inches(143))).toBe(true);
    const stileCenters = result.parts.filter((p) => p.role === 'stile').map((p) => p.bounds.x + p.bounds.width / 2);
    expect(stileCenters).toContain(crown[0]!.bounds.x + crown[0]!.bounds.width);
    expect(crown[0]!.note).toMatch(/scarf joint over the stile/);
  });
});

describe('deriveRun: adjustable shelf nosing', () => {
  const nosed = (more?: (p: Project) => void) =>
    setup((p) => {
      p.settings = { ...p.settings, shelves: { ...p.settings.shelves, adjustableFront: 'nosing' } };
      more?.(p);
    });

  it('puts a frame-lumber nosing on each adjustable shelf, flush with the frame like a fixed shelf rail', () => {
    const { run, result } = nosed();
    const box = boxesOf(tier(run, 1))[0]!;
    const shelf = part(result, `${box.content.id}/adj-shelf-0`);
    const nose = part(result, `${box.content.id}/adj-shelf-0-nosing`);
    const topRail = part(result, `${box.id}/rail-top`);
    expect(nose.role).toBe('rail');
    expect(nose.materialId).toBe(topRail.materialId);
    // In the frame plane, as tall as a mid rail, top flush with the shelf.
    expect([nose.bounds.z, nose.bounds.depth]).toEqual([topRail.bounds.z, topRail.bounds.depth]);
    expect(nose.bounds.height).toBe(inches(1.5));
    expect(nose.bounds.y + nose.bounds.height).toBe(shelf.bounds.y + shelf.bounds.height);
    // The shelf runs to the back of the nosing, and isn't banded (the nosing covers its front).
    expect(shelf.bounds.z + shelf.bounds.depth).toBe(nose.bounds.z);
    expect(shelf.bandedEdges).toBeUndefined();
    // It passes between the stiles with 1/16" each side.
    const opening = result.boxes.find((b) => b.id === box.id)!.sections[0]!.rect;
    expect(nose.bounds.x).toBe(opening.x + inches(1 / 16));
  });

  it('stiffens the shelf against sag', () => {
    const wide = (front: 'banded' | 'nosing') =>
      setup((p, r) => {
        p.settings = { ...p.settings, shelves: { ...p.settings.shelves, adjustableFront: front } };
        // About a 34" span: past the limit for 3/4" plywood, within it with a 3/4 × 1 1/2 nosing.
        r.wall[0]!.length = inches(72);
        tier(r, 1).items = [flexBox(opening({ type: 'none' }, 3)), flexBox(opening({ type: 'none' }, 3))];
        tier(r, 0).items = [flexBox(opening({ type: 'doorPair' }, 1)), flexBox(opening({ type: 'doorPair' }, 1))];
      }).result.issues.filter((i) => i.code === 'shelf-sag' && i.message.startsWith('Adjustable'));
    expect(wide('banded').length).toBeGreaterThan(0);
    expect(wide('nosing')).toEqual([]);
  });

  it('sits behind an inset door', () => {
    const { run, result } = nosed((p) => {
      p.settings = { ...p.settings, fronts: { ...p.settings.fronts, mounting: 'inset' } };
    });
    const op = boxesOf(tier(run, 0))[0]!.content.id;
    const nose = part(result, `${op}/adj-shelf-0-nosing`);
    const door = part(result, `${op}/door-left`);
    expect(nose.bounds.z + nose.bounds.depth).toBeLessThanOrEqual(door.bounds.z - inches(1 / 16));
  });
});

describe('deriveRun: carcass corners', () => {
  const withCarcass = (carcass: Partial<Project['settings']['carcass']>, more?: (p: Project, r: Run) => void) =>
    setup((p, r) => {
      p.settings = { ...p.settings, carcass: { ...p.settings.carcass, ...carcass } };
      more?.(p, r);
    });

  it('runs a top over the sides and back when asked', () => {
    const { run, result } = withCarcass({ topJoint: 'over' });
    const b = boxesOf(tier(run, 0))[0]!;
    const box = result.boxes.find((x) => x.id === b.id)!.carcass;
    const top = part(result, `${b.id}/top`);
    const side = part(result, `${b.id}/side-left`);
    const back = part(result, `${b.id}/back`);
    expect([top.bounds.x, top.bounds.width, top.bounds.z, top.bounds.depth]).toEqual([box.x, box.width, 0, box.depth]);
    expect(side.bounds.y + side.bounds.height).toBe(top.bounds.y);
    expect(back.bounds.y + back.bounds.height).toBe(top.bounds.y);
    expect(top.note).toMatch(/Runs over the sides and the back/);
    expect(side.note).toMatch(/The top runs over it/);
  });

  it('clears the bare side tops on the ledge in front of shallower uppers when automatic', () => {
    const { run, result } = withCarcass({ topJoint: 'auto' });
    expect(result.issues.filter((i) => i.code === 'raw-edges')).toEqual([]);
    // Base tops now run over their sides; the uppers (tops hidden at the ceiling) stay standard.
    const base = boxesOf(tier(run, 0))[0]!.id;
    const upper = boxesOf(tier(run, 1))[0]!.id;
    expect(part(result, `${base}/top`).note).toMatch(/Runs over the sides/);
    expect(part(result, `${upper}/top`).bounds.x).toBe(part(result, `${upper}/side-left`).bounds.x + T);
  });

  it('runs the bottom of a box over a doorway under its sides and back when automatic', () => {
    const { run, result } = withCarcass({ bottomJoint: 'auto' }, (_, r) => {
      addSpan(r, { kind: 'gap', x: { anchor: 'center', offset: 0 }, width: inches(36), tiers: { from: tier(r, 0).id, to: tier(r, 0).id } }, () => 2);
    });
    const over = boxesOf(tier(run, 1)).find((b) => {
      const c = result.boxes.find((x) => x.id === b.id)!.carcass;
      return c.x < inches(50) && c.x + c.width > inches(50);
    })!;
    // Its edges over the gap are covered now.
    expect(result.parts.filter((p) => p.ownerId === over.id && p.rawEdges)).toEqual([]);
    const c = result.boxes.find((x) => x.id === over.id)!.carcass;
    const finished = part(result, `${over.id}/bottom-finish`);
    expect([finished.bounds.x, finished.bounds.width, finished.bounds.z]).toEqual([c.x, c.width, 0]);
    expect(part(result, `${over.id}/side-left`).bounds.y).toBe(c.y + T);
    // Boxes that aren't over the gap keep their standard joints.
    const other = boxesOf(tier(run, 1))[3]!.id;
    expect(part(result, `${other}/side-left`).bounds.y).toBe(result.boxes.find((x) => x.id === other)!.carcass.y);
  });

  it('only runs a bottom under the sides where it sits at the carcass bottom', () => {
    // A raised bottom (above the bottom rail) stays between the sides even when asked.
    const { run, result } = withCarcass({ bottomJoint: 'under' });
    const b = boxesOf(tier(run, 0))[0]!.id;
    expect(part(result, `${b}/bottom`).bounds.x).toBe(part(result, `${b}/side-left`).bounds.x + T);
    // Frameless bottoms are at the carcass bottom, so they run under.
    const frameless = withCarcass({ bottomJoint: 'under' }, (p) => {
      p.settings = { ...p.settings, construction: 'frameless' };
    });
    const fb = boxesOf(tier(frameless.run, 0))[0]!.id;
    const c = frameless.result.boxes.find((x) => x.id === fb)!.carcass;
    expect(part(frameless.result, `${fb}/bottom`).bounds.x).toBe(c.x);
    expect(part(frameless.result, `${fb}/side-left`).note).toMatch(/Sits on the bottom/);
  });

  it('sets a rabbeted back into the sides, top and bottom, hiding its edges', () => {
    const { run, result } = setup((p) => {
      p.settings = { ...p.settings, back: 'rabbeted' };
    });
    const b = boxesOf(tier(run, 1))[0]!.id;
    const c = result.boxes.find((x) => x.id === b)!.carcass;
    const side = part(result, `${b}/side-left`);
    const back = part(result, `${b}/back`);
    expect([side.bounds.z, side.bounds.depth]).toEqual([0, c.depth]);
    expect(back.bounds.x).toBe(c.x + T - inches(11 / 32));
    expect(back.note).toMatch(/Fits rabbets 11\/32" deep/);
    expect(side.note).toMatch(/Rabbet 11\/32" × 7\/32" along the back edge/);
    expect(result.parts.filter((p) => p.role === 'back' && p.rawEdges)).toEqual([]);
  });
});

describe('deriveRun: mitred toe kick returns', () => {
  const gapped = (mitre: boolean) =>
    setup((_, r) => {
      addSpan(r, { kind: 'gap', x: { anchor: 'center', offset: 0 }, width: inches(36), tiers: { from: tier(r, 0).id, to: tier(r, 0).id } }, () => 2);
      tier(r, 0).toeKick = { ...tier(r, 0).toeKick!, mitreOpenEnds: mitre };
    });
  const kickRaw = (r: RunResult, tierId: string) => r.parts.filter((p) => p.ownerId === tierId && p.role === 'toeKick' && p.rawEdges);

  it('leaves kick board ends showing at a doorway without returns', () => {
    const { run, result } = gapped(false);
    expect(kickRaw(result, tier(run, 0).id).length).toBeGreaterThan(0);
  });

  it('wraps the kick around the open ends with mitered, full-depth returns', () => {
    const { run, result } = gapped(true);
    const tierId = tier(run, 0).id;
    expect(kickRaw(result, tierId)).toEqual([]);
    const ret = result.parts.find((p) => p.ownerId === tierId && p.id.endsWith('kick-0-return-right'))!;
    const front = result.parts.find((p) => p.ownerId === tierId && p.id.endsWith('kick-0-front'))!;
    const back = result.parts.find((p) => p.ownerId === tierId && p.id.endsWith('kick-0-back'))!;
    // The return runs from the wall to the front face; the front board runs to the corner; the back stops at the return.
    expect([ret.bounds.z, ret.bounds.z + ret.bounds.depth]).toEqual([0, front.bounds.z + front.bounds.depth]);
    expect(front.bounds.x + front.bounds.width).toBe(ret.bounds.x + ret.bounds.width);
    expect(back.bounds.x + back.bounds.width).toBe(ret.bounds.x);
    expect(front.note).toMatch(/45° miter at the right end/);
    expect(front.mitres).toEqual([{ face: 'right', outer: 'front' }]);
    expect(ret.mitres).toEqual([{ face: 'front', outer: 'right' }]);
  });
});
