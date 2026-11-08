/** Shared fixtures for drawing helper tests: the default project and a few variants, derived. */
import { createDefaultProject, deriveRun, inches, newId, opening, type Box, type Project, type Run, type RunResult } from '@built-in-planner/engine';

export const T = inches(23 / 32);
export const FRAME = inches(3 / 4);

export function derive(mutate?: (p: Project, run: Run) => void): { project: Project; run: Run; result: RunResult } {
  const project = createDefaultProject();
  const run = project.runs[0]!;
  mutate?.(project, run);
  return { project, run, result: deriveRun(project, run.id) };
}

export const tierBoxes = (run: Run, i: number): Box[] => run.tiers[i]!.items.filter((it): it is Box => it.kind === 'box');

/** Default project with a 1 1/2" countertop on the base (1" front and end overhang). */
export const withCounter = (_: Project, run: Run) => {
  run.tiers[0]!.countertop = { thickness: inches(1.5), frontOverhang: inches(1), endOverhang: inches(1) };
};

/** Default project whose last base box is a bank of three drawers. */
export const withDrawers = (_: Project, run: Run) => {
  const b = tierBoxes(run, 0)[3]!;
  b.content = {
    kind: 'split',
    id: newId(),
    direction: 'rows',
    divider: 'frameOnly',
    children: [0, 1, 2].map(() => ({ size: { kind: 'flex' as const, ratio: 1 }, section: opening({ type: 'drawer' }) })),
  };
};

/** Default project with a 36" doorway gap at the right end of the base tier. */
export const withDoorway = (_: Project, run: Run) => {
  const base = run.tiers[0]!;
  const id = newId();
  run.spans.push({ id, kind: 'gap', name: 'door', x: { anchor: 'right', offset: 0 }, width: inches(36), tiers: { from: base.id, to: base.id }, content: opening() });
  base.items = [...base.items.slice(0, 3), { kind: 'slot', spanId: id }];
};
