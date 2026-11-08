import { describe, expect, it } from 'vitest';
import { buildCutReport } from '../cutlist/index';
import { createDefaultProject } from '../defaults';
import { deriveProject } from '../derive/index';
import type { Project } from '../model';
import { inches } from '../units';
import { buildInstructions, type BuildPlan } from './instructions';

const planFor = (mutate?: (p: Project) => void): { project: Project; plan: BuildPlan } => {
  const project = createDefaultProject();
  mutate?.(project);
  const results = deriveProject(project);
  return { project, plan: buildInstructions(project, results, buildCutReport(project, results)) };
};
const steps = (plan: BuildPlan) => plan.sections.flatMap((s) => s.steps);

describe('buildInstructions', () => {
  it('goes from preparation through each tier, bottom to top, to trim, fronts and finishing', () => {
    const { plan } = planFor();
    expect(plan.sections.map((s) => s.title)).toEqual([
      'Before you start',
      'Cut and prepare the parts',
      'Base (tier 1 of 2, from the bottom)',
      'Upper (tier 2 of 2, from the bottom)',
      'Doors, drawers and shelves',
      'Finish',
    ]);
    expect(plan.stepCount).toBe(steps(plan).length);
    // In the base tier: the toe kick, each box, setting them, then its own face frame (the uppers are shallower).
    const base = plan.sections[2]!.steps.map((s) => s.title);
    // The four base boxes are identical: one step builds all of them.
    expect(base).toEqual(['Build and level the toe kick platform', 'Build Base 1, 2, 3 and 4 (4 identical boxes)', 'Set and fasten the boxes', 'Build and attach the face frame']);
  });

  it('names parts by their cut list letters', () => {
    const project = createDefaultProject();
    const results = deriveProject(project);
    const report = buildCutReport(project, results);
    const plan = buildInstructions(project, results, report);
    const box = steps(plan).find((s) => s.title.startsWith('Build Base 1'))!;
    const sides = box.parts.find((p) => p.name.includes('side'))!;
    const row = report.cutList.sheetGoods.flatMap((g) => g.rows).find((r) => r.label === sides.label)!;
    // Two sides per box, four identical boxes: the whole cut list row.
    expect([sides.qty, sides.length, sides.width]).toEqual([8, row.length, row.width]);
    expect(row.qty).toBe(8);
    expect(box.how[0]).toBe('Build 4 of these the same way.');
    expect(box.how.some((h) => /Fit the bottom between the sides with its underside/.test(h))).toBe(true);
    expect(box.locate?.ownerId).toBe(project.runs[0]!.tiers[0]!.items[0]!.kind === 'box' ? project.runs[0]!.tiers[0]!.items[0]!.id : '');
  });

  it('follows the corner joints and joinery', () => {
    const { plan } = planFor((p) => {
      p.settings = { ...p.settings, joinery: 'dado', carcass: { ...p.settings.carcass, topJoint: 'over' } };
    });
    const box = steps(plan).find((s) => s.title.startsWith('Build Base 1'))!;
    expect(box.how.some((h) => h.startsWith('Set the top over the sides') && h.includes('glue it into its dados'))).toBe(true);
    expect(steps(plan).find((s) => s.title === 'Cut the joints')!.how[0]).toMatch(/1\/4" deep dados/);
  });

  it('describes mitered toe kick returns and finds pieced parts', () => {
    const { plan } = planFor((p) => {
      const run = p.runs[0]!;
      run.wall[0]!.length = inches(147);
      run.tiers[1]!.items = [{ kind: 'box', id: 'wide', width: { kind: 'flex', ratio: 1 }, content: { kind: 'opening', id: 'o', front: { type: 'none' }, adjustableShelves: 0 }, overrides: { splitOversize: true } }];
      run.tiers[0]!.toeKick = { ...run.tiers[0]!.toeKick!, mitreOpenEnds: true };
      run.ends.right = 'open';
    });
    const kick = steps(plan).find((s) => s.title === 'Build and level the toe kick platform')!;
    expect(kick.how.some((h) => /45° miter/.test(h))).toBe(true);
    const wide = steps(plan).find((s) => s.title === 'Build Upper 1')!;
    expect(wide.how[0]).toMatch(/Join the pieced/);
    expect(wide.how.some((h) => h.startsWith('Fit the top between the sides'))).toBe(true);
    // A tier with one box isn't told to clamp it to its neighbors.
    const set = plan.sections.find((s) => s.title.startsWith('Upper'))!.steps.find((s) => s.title === 'Set and fasten the boxes')!;
    expect(set.how[0]).toBe('Set Upper 1 on the tier below.');
    expect(set.how.some((h) => /neighbor/.test(h))).toBe(false);
  });

  it('lists hinges, shelf pins and banding where the design has them', () => {
    const { plan } = planFor();
    const all = steps(plan);
    expect(all.find((s) => s.title === 'Hang the doors')!.hardware.join(' ')).toMatch(/Concealed 35 mm/);
    expect(all.find((s) => s.title === 'Set the adjustable shelves')!.hardware.join(' ')).toMatch(/shelf pins/);
    expect(all.find((s) => s.title === 'Band the edges')!.how.join(' ')).toMatch(/front edge/);
    expect(all.find((s) => s.title === 'Drill the holes')!.how.join(' ')).toMatch(/Hinge cups: \d+ holes/);
  });
});
