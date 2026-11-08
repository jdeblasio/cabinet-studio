import { describe, expect, it } from 'vitest';
import { createDefaultProject } from './defaults';
import type { Box, Opening, Project, Run, Split } from './model';
import {
  addBox,
  addSpan,
  addSplitChild,
  addTier,
  clearOverride,
  findBox,
  findSectionInRun,
  placeSpanSlots,
  removeBox,
  removeSection,
  removeSpan,
  removeTier,
  resizeBoundary,
  sectionPath,
  setAdjustableShelves,
  setFront,
  setOverride,
  setProjectSetting,
  setSpanTiers,
  splitOpening,
  unsplit,
} from './ops';
import { resolveSettings, settingSource } from './settings';
import { inches } from './units';

const GRID = inches(1 / 32);

function setup(): { project: Project; run: Run } {
  const project = createDefaultProject();
  return { project, run: project.runs[0]! };
}

const boxes = (run: Run, tierIndex: number): Box[] =>
  run.tiers[tierIndex]!.items.filter((it): it is Box => it.kind === 'box');

describe('tier items', () => {
  it('adds a box to the right of a reference, copying its width spec and layout with fresh ids', () => {
    const { run } = setup();
    const [first] = boxes(run, 0);
    const before = boxes(run, 0).length;
    const id = addBox(run, run.tiers[0]!.id, first!.id, 'right')!;
    const tierBoxes = boxes(run, 0);
    expect(tierBoxes).toHaveLength(before + 1);
    expect(tierBoxes[1]!.id).toBe(id);
    expect(tierBoxes[1]!.width).toEqual(first!.width);
    expect(tierBoxes[1]!.content.id).not.toBe(first!.content.id);
    expect((tierBoxes[1]!.content as Opening).front).toEqual({ type: 'doorPair' });
  });

  it('adds to the left and appends when the reference is null', () => {
    const { run } = setup();
    const tierId = run.tiers[0]!.id;
    const [first] = boxes(run, 0);
    const left = addBox(run, tierId, first!.id, 'left')!;
    expect(boxes(run, 0)[0]!.id).toBe(left);
    const end = addBox(run, tierId, null)!;
    expect(boxes(run, 0).at(-1)!.id).toBe(end);
  });

  it('removes a box', () => {
    const { run } = setup();
    const [first] = boxes(run, 0);
    expect(removeBox(run, first!.id)).toBe(true);
    expect(findBox(run, first!.id)).toBeUndefined();
    expect(removeBox(run, 'nope')).toBe(false);
  });
});

describe('tiers', () => {
  it('adds a tier above / below and moves the toe kick to the new bottom tier', () => {
    const { run } = setup();
    const base = run.tiers[0]!;
    const above = addTier(run, base.id, 'above');
    expect(run.tiers[1]!.id).toBe(above);
    const below = addTier(run, base.id, 'below');
    expect(run.tiers[0]!.id).toBe(below);
    expect(run.tiers[0]!.toeKick).toBeDefined();
    expect(base.toeKick).toBeUndefined();
  });

  it('removing a tier shrinks span ranges and drops spans with no tiers left', () => {
    const { project, run } = setup();
    const [base, upper] = run.tiers;
    const tall = addSpan(project, run.id, { kind: 'box', fromTierId: base!.id, toTierId: upper!.id, width: inches(24) })!;
    const short = addSpan(project, run.id, { kind: 'gap', fromTierId: upper!.id, toTierId: upper!.id, width: inches(30), x: { anchor: 'right', offset: 0 } })!;
    removeTier(run, upper!.id);
    expect(run.spans.find((s) => s.id === short)).toBeUndefined();
    const t = run.spans.find((s) => s.id === tall)!;
    expect(t.tiers).toEqual({ from: base!.id, to: base!.id });
  });
});

describe('sections', () => {
  it('splits an opening into rows, keeping the original as the first child', () => {
    const { run } = setup();
    const box = boxes(run, 0)[0]!;
    const original = box.content as Opening;
    const splitId = splitOpening(run, original.id, 'rows', 3)!;
    const split = box.content as Split;
    expect(split.id).toBe(splitId);
    expect(split.children).toHaveLength(3);
    expect(split.children[0]!.section.id).toBe(original.id);
    expect(split.children.every((c) => c.size.kind === 'flex')).toBe(true);
    expect(sectionPath(box.content, split.children[2]!.section.id)).toEqual([splitId, split.children[2]!.section.id]);
  });

  it('splits nested sections and finds them in the run', () => {
    const { run } = setup();
    const box = boxes(run, 0)[0]!;
    splitOpening(run, box.content.id, 'rows', 2);
    const bottom = (box.content as Split).children[1]!.section;
    const inner = splitOpening(run, bottom.id, 'columns', 2, 'panel')!;
    const hit = findSectionInRun(run, inner)!;
    expect(hit.owner.id).toBe(box.id);
    expect(hit.parent?.id).toBe(box.content.id);
  });

  it('unsplit collapses to the first opening', () => {
    const { run } = setup();
    const box = boxes(run, 0)[0]!;
    const originalId = box.content.id;
    const splitId = splitOpening(run, originalId, 'columns', 2)!;
    expect(unsplit(run, splitId)).toBe(originalId);
    expect(box.content.id).toBe(originalId);
  });

  it('removing a child collapses a split with one child left', () => {
    const { run } = setup();
    const box = boxes(run, 0)[0]!;
    const splitId = splitOpening(run, box.content.id, 'rows', 2)!;
    const added = addSplitChild(run, splitId)!;
    expect((box.content as Split).children).toHaveLength(3);
    removeSection(run, added);
    const second = (box.content as Split).children[1]!.section.id;
    removeSection(run, second);
    expect(box.content.kind).toBe('opening');
  });

  it('sets fronts and shelf counts', () => {
    const { run } = setup();
    const box = boxes(run, 0)[0]!;
    expect(setFront(run, box.content.id, { type: 'drawer' })).toBe(true);
    expect(setAdjustableShelves(run, box.content.id, 2.6)).toBe(true);
    expect(box.content).toMatchObject({ front: { type: 'drawer' }, adjustableShelves: 3 });
    expect(setAdjustableShelves(run, box.content.id, -1)).toBe(true);
    expect((box.content as Opening).adjustableShelves).toBe(0);
  });
});

describe('spans', () => {
  it('inserts slot markers in every spanned boxes tier, positioned by x', () => {
    const { project, run } = setup();
    const [base, upper] = run.tiers;
    const left = addSpan(project, run.id, { kind: 'box', fromTierId: base!.id, toTierId: upper!.id, width: inches(24) })!;
    const right = addSpan(project, run.id, {
      kind: 'box',
      fromTierId: base!.id,
      toTierId: base!.id,
      width: inches(24),
      x: { anchor: 'right', offset: 0 },
    })!;
    expect(base!.items[0]).toEqual({ kind: 'slot', spanId: left });
    expect(upper!.items[0]).toEqual({ kind: 'slot', spanId: left });
    expect(base!.items.at(-1)).toEqual({ kind: 'slot', spanId: right });
    // A left-anchored span with an offset lands after the boxes it clears.
    const offset = addSpan(project, run.id, {
      kind: 'gap',
      fromTierId: upper!.id,
      toTierId: upper!.id,
      width: inches(10),
      x: { anchor: 'left', offset: inches(60) },
    })!;
    const idx = upper!.items.findIndex((it) => it.kind === 'slot' && it.spanId === offset);
    expect(idx).toBeGreaterThan(1);
    expect(idx).toBeLessThan(upper!.items.length - 1);
    expect(upper!.items.some((it) => it.kind === 'slot' && it.spanId === right)).toBe(false);
  });

  it('places a centered span between boxes', () => {
    const { project, run } = setup();
    const base = run.tiers[0]!;
    // Use an even box count so the span center doesn't tie with a box center.
    while (base.items.length % 2) addBox(run, base.id, null);
    const n = base.items.length;
    addSpan(project, run.id, { kind: 'gap', fromTierId: base.id, toTierId: base.id, width: inches(10), x: { anchor: 'center', offset: 0 } });
    // the slot lands in the middle
    expect(base.items.findIndex((it) => it.kind === 'slot')).toBe(n / 2);
  });

  it('re-places slots when the tier range changes and removes them with the span', () => {
    const { project, run } = setup();
    const [base, upper] = run.tiers;
    const id = addSpan(project, run.id, { kind: 'box', fromTierId: base!.id, toTierId: base!.id, width: inches(24) })!;
    setSpanTiers(project, run.id, id, base!.id, upper!.id);
    expect(upper!.items.filter((it) => it.kind === 'slot')).toHaveLength(1);
    setSpanTiers(project, run.id, id, upper!.id, upper!.id);
    expect(base!.items.filter((it) => it.kind === 'slot')).toHaveLength(0);
    expect(placeSpanSlots(project, run.id, id)).toBe(true);
    expect(upper!.items.filter((it) => it.kind === 'slot')).toHaveLength(1);
    removeSpan(run, id);
    expect(run.tiers.flatMap((t) => t.items).some((it) => it.kind === 'slot')).toBe(false);
  });
});

describe('settings overrides', () => {
  it('sets and clears overrides, pruning empty objects', () => {
    const { project, run } = setup();
    const tier = run.tiers[0]!;
    setOverride(tier, 'faceFrame.topRailWidth', inches(2));
    expect(resolveSettings(project, [run, tier]).faceFrame.topRailWidth).toBe(inches(2));
    expect(settingSource(project, [run, tier], 'faceFrame.topRailWidth')).toBe(1);
    clearOverride(tier, 'faceFrame.topRailWidth');
    expect(tier.overrides).toBeUndefined();
    expect(settingSource(project, [run, tier], 'faceFrame.topRailWidth')).toBe(-1);
  });

  it('keeps sibling overrides when clearing one', () => {
    const { run } = setup();
    setOverride(run, 'faceFrame.topRailWidth', inches(2));
    setOverride(run, 'faceFrame.lip', inches(1 / 4));
    setOverride(run, 'back', 'none');
    clearOverride(run, 'faceFrame.lip');
    expect(run.overrides).toEqual({ faceFrame: { topRailWidth: inches(2) }, back: 'none' });
  });

  it('sets project-level defaults', () => {
    const { project } = setup();
    setProjectSetting(project, 'fronts.mounting', 'inset');
    expect(project.settings.fronts.mounting).toBe('inset');
  });
});

describe('resizeBoundary', () => {
  const fixed = (size: number) => ({ kind: 'fixed' as const, size });
  const flex = (ratio: number, extra: { min?: number; max?: number } = {}) => ({ kind: 'flex' as const, ratio, ...extra });

  it('fixed + fixed: both get new snapped fixed sizes, sum preserved', () => {
    const r = resizeBoundary({ spec: fixed(inches(20)), size: inches(20) }, { spec: fixed(inches(30)), size: inches(30) }, inches(2.01), { grid: GRID });
    expect(r.a).toEqual(fixed(inches(22)));
    expect(r.b).toEqual(fixed(inches(28)));
    expect(r.delta).toBe(inches(2));
  });

  it('flex + flex: redistributes the combined ratio in proportion to the new sizes', () => {
    const r = resizeBoundary({ spec: flex(1), size: inches(30) }, { spec: flex(1), size: inches(30) }, inches(10), { grid: GRID });
    expect((r.a as { ratio: number }).ratio).toBeCloseTo(4 / 3, 6);
    expect((r.a as { ratio: number }).ratio + (r.b as { ratio: number }).ratio).toBeCloseTo(2, 6);
    expect(r.delta).toBe(inches(10));
  });

  it('fixed + flex: only the fixed item changes', () => {
    const r = resizeBoundary({ spec: fixed(inches(24)), size: inches(24) }, { spec: flex(1), size: inches(36) }, -inches(4), { grid: GRID });
    expect(r.a).toEqual(fixed(inches(20)));
    expect(r.b).toEqual(flex(1));
  });

  it('flex + fixed: snaps the fixed side', () => {
    const r = resizeBoundary({ spec: flex(2), size: inches(36) + 100 }, { spec: fixed(inches(24)), size: inches(24) }, inches(1) + 7, { grid: GRID });
    expect(r.a).toEqual(flex(2));
    expect(r.b).toEqual(fixed(inches(23)));
  });

  it('respects minSize and flex min/max', () => {
    const minSize = inches(3);
    const r = resizeBoundary({ spec: fixed(inches(10)), size: inches(10) }, { spec: fixed(inches(10)), size: inches(10) }, inches(50), { grid: GRID, minSize });
    expect(r.a).toEqual(fixed(inches(17)));
    expect(r.b).toEqual(fixed(inches(3)));

    const r2 = resizeBoundary({ spec: flex(1, { max: inches(12) }), size: inches(10) }, { spec: flex(1), size: inches(10) }, inches(5), { grid: GRID });
    expect(r2.delta).toBe(inches(2));
  });
});
