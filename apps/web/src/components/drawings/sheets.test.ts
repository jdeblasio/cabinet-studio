import { deriveRun, newId } from '@built-in-planner/engine';
import { describe, expect, it } from 'vitest';
import { derive, withDrawers } from './fixtures.test-util';
import { buildSheets } from './sheets';

describe('buildSheets', () => {
  it('orders a run as elevation, plan, sections, then a sheet per box by number', () => {
    const { project, result } = derive(withDrawers);
    const sheets = buildSheets(project, [result], 'imperial');
    expect(sheets.map((s) => s.kind)).toEqual(['elevation', 'plan', 'section', ...Array(8).fill('box')]);
    const section = sheets[2]!;
    expect(section.kind === 'section' && section.sections.map((d) => d.cut.label)).toEqual(['A', 'B']);
    expect(section.title).toBe('Sections A–B');
    expect(sheets.slice(3).map((s) => s.title)).toEqual([1, 2, 3, 4].map((n) => `Box ${n} — Base ${n}`).concat([1, 2, 3, 4].map((n) => `Box ${n + 4} — Upper ${n}`)));
  });

  it('repeats the set for each run', () => {
    const { project, run } = derive();
    project.runs.push({ ...structuredClone(run), id: newId(), name: 'Wall 2' });
    const results = project.runs.map((r) => deriveRun(project, r.id));
    const sheets = buildSheets(project, results, 'imperial');
    expect(sheets).toHaveLength(22);
    expect(new Set(sheets.map((s) => s.key)).size).toBe(22);
    expect(sheets[11]!.run.name).toBe('Wall 2');
  });

  it('still draws the elevation of a run with no boxes', () => {
    const { project, result } = derive((_, r) => {
      r.tiers = [];
    });
    expect(buildSheets(project, [result], 'imperial').map((s) => s.kind)).toEqual(['elevation']);
  });
});
