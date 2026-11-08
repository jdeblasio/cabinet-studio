import type { Material, Ticks, UnitSystem } from '@cabinet-studio/engine';
import { useMemo } from 'react';
import { useFormatter } from '../../lib/units';
import { useProjectResults } from '../../store/derived';
import { BoxSheet } from './BoxSheet';
import { ElevationSheet } from './ElevationSheet';
import { PlanSheet } from './PlanSheet';
import { SectionSheet } from './SectionSheet';
import type { SheetMeta } from './Sheet';
import { buildSheets, type SheetSpec } from './sheets';
import './drawings.css';

/**
 * Landscape pages, one sheet each, only while this view is mounted (so other views keep their
 * own print orientation). Everything else is in drawings.css.
 */
const PAGE_CSS = '@page { size: landscape; margin: 0.35in; }';

/** Printable drawing set, regenerated from the model on every change. */
export function DrawingsView() {
  const { project, results } = useProjectResults();
  const f = useFormatter();
  const system = f.displaySystem;
  const fmt = useMemo(() => (t: number) => f.fmt(t, { showUnits: system === 'imperial' }), [f, system]);
  const date = useMemo(() => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), []);
  // Results are cached per project snapshot (the array itself is new each render), so key on the project.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sheets = useMemo(() => buildSheets(project, results, system), [project, system]);
  const units = system === 'imperial' ? 'inches' : 'mm';

  if (project.runs.length === 0) {
    return <div className="output-view output-placeholder">Add a wall run to get drawings.</div>;
  }

  return (
    <div className="drawings">
      <style>{PAGE_CSS}</style>
      <div className="drawings-bar no-print">
        <div className="drawings-summary">
          <strong>Drawing set</strong>
          <span className="muted">
            {sheets.length} sheet{sheets.length === 1 ? '' : 's'} · landscape, Letter or A4 · print at 100% (no “fit to page”)
            {f.approximate ? ' · showing approximate other units' : ''}
          </span>
        </div>
        <button className="primary" onClick={() => window.print()}>
          Print…
        </button>
      </div>
      <div className="drawings-sheets">
        {sheets.map((s, i) => (
          <SheetFor
            key={s.key}
            spec={s}
            meta={{ projectName: project.name, runName: s.run.name, title: s.title, subtitle: s.subtitle, date, number: i + 1, count: sheets.length, units }}
            materials={project.materials}
            fmt={fmt}
            system={system}
          />
        ))}
      </div>
    </div>
  );
}

/** Render one sheet of the set. */
export function SheetFor({ spec: s, meta, materials, fmt, system }: { spec: SheetSpec; meta: SheetMeta; materials: readonly Material[]; fmt: (t: Ticks) => string; system: UnitSystem }) {
  switch (s.kind) {
    case 'elevation':
      return <ElevationSheet meta={meta} run={s.run} result={s.result} labels={s.labels} cuts={s.cuts} fmt={fmt} system={system} />;
    case 'plan':
      return <PlanSheet meta={meta} run={s.run} result={s.result} labels={s.labels} fmt={fmt} system={system} />;
    case 'section':
      return <SectionSheet meta={meta} result={s.result} sections={s.sections} scale={s.scale} labels={s.labels} materials={materials} fmt={fmt} />;
    case 'box':
      return <BoxSheet meta={meta} result={s.result} box={s.box} label={s.label} materials={materials} fmt={fmt} system={system} />;
  }
}
