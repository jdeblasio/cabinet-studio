/** The drawing set's sheet list: what each sheet shows, in order. Pure, so it can be tested. */
import type { BoxLayout, Id, Project, Run, RunResult, UnitSystem } from '@cabinet-studio/engine';
import { boxLabels, type BoxLabel } from './parts';
import { planTiers } from './plan';
import { AREA, VIEW, packViews, type Scale } from './scale';
import { extractSection, sectionCuts, sectionLayout, type SectionCut, type SectionData } from './section';

export type SheetSpec = { key: string; title: string; subtitle?: string; run: Run; result: RunResult } & (
  | { kind: 'elevation'; labels: Map<Id, BoxLabel>; cuts: SectionCut[] }
  | { kind: 'plan'; labels: Map<Id, BoxLabel> }
  | { kind: 'section'; labels: Map<Id, BoxLabel>; sections: SectionData[]; scale: Scale }
  | { kind: 'box'; box: BoxLayout; label: BoxLabel }
);

/** The sheets of the drawing set, run by run: elevation, plan, sections, then one sheet per box. */
export function buildSheets(project: Project, results: readonly RunResult[], system: UnitSystem): SheetSpec[] {
  const sheets: SheetSpec[] = [];
  project.runs.forEach((run, ri) => {
    const result = results[ri];
    if (!result) return;
    const labels = boxLabels(run, result);
    const cuts = sectionCuts(result);
    const base = { run, result };
    sheets.push({
      ...base,
      key: `${run.id}/elevation`,
      kind: 'elevation',
      title: 'Front elevation',
      subtitle: cuts.length ? 'Circled numbers: box sheets · lettered marks: sections' : 'Circled numbers refer to box sheets',
      labels,
      cuts,
    });
    if (planTiers(result).length) {
      sheets.push({ ...base, key: `${run.id}/plan`, kind: 'plan', title: 'Plan', subtitle: 'Looking down, wall at top', labels });
    }
    const sections = cuts.map((c) => extractSection(result, c));
    const { scale, sheets: pages } = packViews(
      sections.map((d) => sectionLayout(result, d).need),
      AREA,
      { gap: VIEW.gap, system },
    );
    pages.forEach((idx, pi) => {
      const group = idx.map((i) => sections[i]!);
      const letters = group.map((d) => d.cut.label);
      sheets.push({
        ...base,
        key: `${run.id}/sections-${pi}`,
        kind: 'section',
        title: letters.length > 1 ? `Sections ${letters[0]}–${letters[letters.length - 1]}` : `Section ${letters[0]}`,
        subtitle: 'Looking toward the right wall',
        labels,
        sections: group,
        scale,
      });
    });
    const ordered = [...result.boxes].sort((a, b) => (labels.get(a.id)?.num ?? 0) - (labels.get(b.id)?.num ?? 0));
    for (const box of ordered) {
      const label = labels.get(box.id);
      if (!label) continue;
      sheets.push({ ...base, key: `${run.id}/box-${box.id}`, kind: 'box', title: `Box ${label.num} — ${label.name}`, subtitle: label.tierName, box, label });
    }
  });
  return sheets;
}
