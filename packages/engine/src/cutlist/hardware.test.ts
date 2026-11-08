import { describe, expect, it } from 'vitest';
import { createDefaultProject, DEFAULT_HARDWARE } from '../defaults';
import { deriveProject } from '../derive/index';
import type { BoxLayout, SectionLayout } from '../derived';
import type { Front } from '../model';
import { inches, mm } from '../units';
import { EDGE_BANDING_ALLOWANCE, estimateHardware, hingesFor, slideLengthFor } from './hardware';
import { fakePart, fakeResult, projectWith } from './testing';

const opening = (front: Front, height: number, id = `o-${height}-${front.type}`): SectionLayout => ({
  sectionId: id,
  kind: 'opening',
  rect: { x: 0, y: 0, width: inches(20), height: inches(height) },
  front,
});
const box = (id: string, sections: SectionLayout[], depth = 16): BoxLayout => ({
  id,
  source: 'tier',
  tierId: 't',
  carcass: { x: 0, y: 0, z: 0, width: inches(30), height: inches(30), depth: inches(depth) },
  sections,
});

describe('rules', () => {
  it('hinges: 2 up to 40", one more per extra 20"', () => {
    expect([20, 40, 40.03125, 60, 60.5, 80, 81, 100].map((h) => hingesFor(inches(h)))).toEqual([2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it('slides: the longest length of the type that fits the inside depth with clearance', () => {
    const imperial = [10, 12, 14, 16, 18, 20, 22, 24].map(inches);
    expect(slideLengthFor(inches(15 + 25 / 32), imperial)).toBe(inches(14));
    expect(slideLengthFor(inches(22.5), imperial)).toBe(inches(22));
    expect(slideLengthFor(inches(22.49), imperial)).toBe(inches(20));
    expect(slideLengthFor(inches(10), imperial)).toBeNull();
    const metric = [300, 400, 500, 550].map(mm);
    expect(slideLengthFor(mm(565), metric)).toBe(mm(550));
    expect(slideLengthFor(mm(560), metric)).toBe(mm(500));
  });
});

describe('estimateHardware', () => {
  it('counts doors and drawers from openings, not parts', () => {
    const p = projectWith();
    const r = fakeResult([fakePart({ length: 15 + 25 / 32, width: 15 + 25 / 32, role: 'side', ownerId: 'b1' })], 'run', {
      boxes: [
        box('b1', [
          { sectionId: 's', kind: 'split', rect: { x: 0, y: 0, width: 1, height: 1 } },
          opening({ type: 'door', hinge: 'left' }, 30),
          opening({ type: 'doorPair' }, 70),
          opening({ type: 'drawer' }, 6, 'd1'),
          opening({ type: 'drawer' }, 6, 'd2'),
          opening({ type: 'none' }, 12),
        ]),
        box('b2', [opening({ type: 'drawer' }, 8)], 24),
      ],
    });
    const hw = estimateHardware(p, [r]);
    expect(hw.doors).toBe(3);
    expect(hw.drawers).toBe(3);
    const hinges = hw.hardware.find((h) => h.kind === 'hinge')!;
    expect(hinges.qty).toBe(2 + 2 * 4);
    const slides = hw.hardware.filter((h) => h.kind === 'drawerSlide');
    // b1's side panel gives its inside depth; b2 has no side part, so its carcass depth is used.
    expect(slides.map((s) => [s.length, s.qty, s.unit])).toEqual([
      [inches(22), 1, 'pair'],
      [inches(14), 2, 'pair'],
    ]);
  });

  it('takes the slide length from the derived drawer box', () => {
    const p = projectWith();
    const drawerSide = fakePart({ id: 'd1/drawer-side-left', length: 18, width: 5, role: 'drawerBox', ownerId: 'b1' });
    const r = fakeResult([drawerSide], 'run', { boxes: [box('b1', [opening({ type: 'drawer' }, 6, 'd1')], 24)] });
    const slides = estimateHardware(p, [r]).hardware.filter((h) => h.kind === 'drawerSlide');
    expect(slides.map((s) => [s.length, s.qty, s.typeName])).toEqual([[inches(18), 1, 'Side-mount ball-bearing, full extension']]);
  });

  it('groups hinges, pins and slides by the hardware type each box uses', () => {
    const p = createDefaultProject();
    p.hardware = {
      ...DEFAULT_HARDWARE,
      shelfPins: [...DEFAULT_HARDWARE.shelfPins, { id: 'pin-3', name: 'Spoon pins', diameter: mm(5), perShelf: 3 }],
    };
    const run = p.runs[0]!;
    const [first, second] = run.tiers[0]!.items;
    if (first?.kind === 'box') first.overrides = { hardware: { hinge: 'hinge-butt' } };
    if (second?.kind === 'box') second.overrides = { hardware: { shelfPin: 'pin-3' } };
    const hw = estimateHardware(p, deriveProject(p));
    const hinges = hw.hardware.filter((h) => h.kind === 'hinge').map((h) => [h.typeName, h.qty]);
    expect(hinges).toEqual(
      expect.arrayContaining([
        ['Butt hinge (inset doors)', 4],
        ['Concealed 35 mm, face-frame mount', 12],
      ]),
    );
    const pins = hw.hardware.filter((h) => h.kind === 'shelfPin').map((h) => [h.typeName, h.qty]);
    // Base box 2 has 1 shelf at 3 pins; the other 15 shelves have 4.
    expect(pins).toEqual(
      expect.arrayContaining([
        ['Spoon pins', 3],
        ['5 mm shelf pins', 60],
      ]),
    );
  });

  it('sums the banding the derivation recorded on parts', () => {
    const p = projectWith();
    const parts = [
      { ...fakePart({ length: 28, width: 11, role: 'adjustableShelf' }), banding: inches(28) },
      { ...fakePart({ length: 24, width: 14, role: 'door' }), banding: inches(76) },
      { ...fakePart({ length: 30, width: 15, role: 'side' }), banding: inches(30) },
      fakePart({ length: 28, width: 15, role: 'fixedShelf' }),
    ];
    const hw = estimateHardware(p, [fakeResult(parts)]);
    expect(hw.edgeBanding).toEqual([{ thickness: inches(23 / 32), edges: 6, parts: 3, length: inches(134), purchaseLength: inches(134) + 6 * EDGE_BANDING_ALLOWANCE }]);
  });

  it('lists no banding when the project has banding settings but no part is banded (banding off)', () => {
    const p = projectWith();
    const hw = estimateHardware(p, [fakeResult([fakePart({ length: 28, width: 11, role: 'adjustableShelf' })])]);
    expect(p.settings.edgeBanding).toBeDefined();
    expect(hw.edgeBanding).toEqual([]);
  });

  it('falls back to banding plywood shelves and slab fronts for older projects', () => {
    const p = projectWith();
    const { edgeBanding: _drop, ...settings } = p.settings as typeof p.settings & { edgeBanding?: unknown };
    p.settings = settings as typeof p.settings;
    const parts = [
      fakePart({ length: 28, width: 11, role: 'adjustableShelf' }),
      fakePart({ length: 28, width: 11, role: 'adjustableShelf' }),
      fakePart({ length: 28, width: 15, role: 'fixedShelf' }),
      fakePart({ length: 24, width: 14, role: 'door' }),
      fakePart({ length: 6, width: 20, role: 'drawerFront' }),
      // Not banded: a lumber shelf, a 5-piece front's parts, a side.
      fakePart({ length: 28, width: 11, role: 'fixedShelf', materialId: 'poplar-3-4', thickness: 0.75 }),
      fakePart({ length: 24, width: 3, role: 'side' }),
    ];
    const hw = estimateHardware(p, [fakeResult(parts)]);
    expect(hw.hardware.find((h) => h.kind === 'shelfPin')?.qty).toBe(2 * 4);
    expect(hw.edgeBanding).toHaveLength(1);
    const b = hw.edgeBanding[0]!;
    expect(b.thickness).toBe(inches(23 / 32));
    expect(b.edges).toBe(3 + 4 + 4);
    expect(b.parts).toBe(5);
    expect(b.length).toBe(inches(28 * 3 + 2 * (24 + 14) + 2 * (6 + 20)));
    expect(b.purchaseLength).toBe(b.length + 11 * EDGE_BANDING_ALLOWANCE);
  });

  it('works on the default project', () => {
    const p = createDefaultProject();
    const hw = estimateHardware(p, deriveProject(p));
    // 4 base boxes × door pair, each opening 23 1/2" tall → 2 hinges per door.
    expect(hw.doors).toBe(8);
    expect(hw.hardware.find((h) => h.kind === 'hinge')?.qty).toBe(16);
    // 1 adjustable shelf per base box, 3 per upper box.
    expect(hw.hardware.find((h) => h.kind === 'shelfPin')?.qty).toBe(4 * 16);
    expect(hw.hardware.some((h) => h.kind === 'drawerSlide')).toBe(false);
  });

  it('returns nothing for an empty design', () => {
    expect(estimateHardware(projectWith(), [])).toEqual({ doors: 0, drawers: 0, hardware: [], edgeBanding: [] });
  });
});
