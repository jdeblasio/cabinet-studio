/** Sheet layouts (guillotine) and lumber boards, with the optimizer settings. */
import { inches, type GlueUp, type LumberPlan, type Project, type SheetNesting, type UnplacedPart } from '@built-in-planner/engine';
import { IssueSummary, OutputBoundary, OutputHeader, pct, plural, PrintButton, Swatch, useOutputFormat } from './common';
import { BoardBar, SheetDiagram } from './diagrams';
import { OptionsPanel } from './OptionsPanel';
import { useCutOptions, useCutReport, useProjectCutOptions } from './state';
import './outputs.css';

const FIT_CODES = new Set(['part-exceeds-sheet', 'part-exceeds-stock', 'sheet-size-missing', 'lumber-no-stock', 'cutlist-material-missing']);

const colorOf = (project: Project, materialId: string) => project.materials.find((m) => m.id === materialId)?.color ?? '#d9cdb8';

const REASON: Record<UnplacedPart['reason'], string> = {
  'too-long': 'longer than the sheet',
  'too-wide': 'wider than the sheet',
  'no-sheet-size': 'material has no sheet size',
};

function Unplaced({ list }: { list: readonly UnplacedPart[] }) {
  const { fmt } = useOutputFormat();
  // One line per cut list row.
  const rows = new Map<string, { u: UnplacedPart; n: number }>();
  for (const u of list) {
    const r = rows.get(u.label);
    if (r) r.n++;
    else rows.set(u.label, { u, n: 1 });
  }
  return (
    <div className="sl-unplaced">
      <strong>Not placed ({list.length})</strong>
      <ul>
        {[...rows.values()].map(({ u, n }) => (
          <li key={u.label}>
            <b>{u.label}</b> {n > 1 ? `${n} × ` : ''}
            {u.part.name}, {fmt(u.part.length)} × {fmt(u.part.width)}: {REASON[u.reason]}
            {u.fitsAcrossGrain ? ' with the grain (fits across it with "Follow the grain" off)' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MaterialSheets({ nest, color, showCuts }: { nest: SheetNesting; color: string; showCuts: boolean }) {
  const f = useOutputFormat();
  const n = nest.sheets.length;
  return (
    <section className="out-group sl-material">
      <h3>
        <Swatch color={color} />
        {nest.materialName}
        <span className="out-group-sum">
          {plural(n, 'sheet')}
          {n > 0 && ` · ${pct(nest.utilization)} yield`}
        </span>
      </h3>
      {nest.length > 0 && (
        <p className="out-sub">
          {f.fmt(nest.length)} × {f.fmt(nest.width)} sheets
          {nest.grain === 'length' ? (nest.rotation ? ' · grain ignored, parts may turn' : ` · grain along the ${f.fmt(nest.length)} length`) : ' · no grain, parts may turn'}
          {' · '}kerf {f.fmt(nest.kerf)}
          {nest.usable && ` · usable ${f.fmt(nest.usable.w)} × ${f.fmt(nest.usable.h)} after trim`}
        </p>
      )}
      {nest.unplaced.length > 0 && <Unplaced list={nest.unplaced} />}
      <div className="sl-sheets">
        {nest.sheets.map((s) => (
          <figure key={s.index} className="sl-sheet">
            <figcaption>
              <strong>
                Sheet {s.index + 1} of {n}
              </strong>
              <span className="muted">
                {plural(s.placements.length, 'part')} · {pct(s.utilization)} used
                {s.offcuts[0] && Math.min(s.offcuts[0].w, s.offcuts[0].h) >= inches(6) && ` · largest offcut ${f.fmt(s.offcuts[0].w)} × ${f.fmt(s.offcuts[0].h)}`}
              </span>
            </figcaption>
            <SheetDiagram nest={nest} sheet={s} color={color} showCuts={showCuts} />
          </figure>
        ))}
      </div>
    </section>
  );
}

function LumberPlanView({ plan, color, maxLength }: { plan: LumberPlan; color: string; maxLength: number }) {
  const f = useOutputFormat();
  const opts = useProjectCutOptions().lumber;
  return (
    <section className="out-group lb-plan">
      <h3>
        <Swatch color={color} />
        {plan.materialName}
        <span className="out-group-meta">
          · {f.fmt(plan.thickness)} × {f.fmt(plan.width)}
        </span>
        <span className="out-group-sum">
          {plan.stock.map((s) => `${s.count} × ${f.stock(s.length)}`).join(', ') || 'no boards'}
          {plan.boards.length > 0 && ` · ${f.bf(plan.boardFeet)} · ${pct(plan.utilization)} yield`}
        </span>
      </h3>
      {plan.tooLong.length > 0 && (
        <div className="sl-unplaced">
          <strong>Longer than any stock board ({plan.tooLong.length})</strong>
          <ul>
            {plan.tooLong.map((p, i) => (
              <li key={i}>
                <b>{p.label}</b> {p.part.name}, {f.fmt(p.length)}
                {p.strip ? ` (glue-up strip ${p.strip.index} of ${p.strip.of})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="lb-boards">
        {plan.boards.map((b, i) => (
          <BoardBar key={i} board={b} maxLength={maxLength} color={color} opts={opts} />
        ))}
      </div>
    </section>
  );
}

function GlueUps({ list }: { list: readonly GlueUp[] }) {
  const { fmt } = useOutputFormat();
  return (
    <section className="out-group">
      <h3>Glue-ups</h3>
      <table className="out-table">
        <thead>
          <tr>
            <th className="cl-label">#</th>
            <th className="num">Qty</th>
            <th>Part</th>
            <th className="num">Finished</th>
            <th className="num">Boards each</th>
            <th className="num">Board size</th>
          </tr>
        </thead>
        <tbody>
          {list.map((g) => (
            <tr key={g.label}>
              <td className="cl-label">{g.label}</td>
              <td className="num">{g.parts.length}</td>
              <td>{[...new Set(g.parts.map((p) => p.name))].join(', ')}</td>
              <td className="num len">
                {fmt(g.length)} × {fmt(g.width)} × {fmt(g.thickness)}
              </td>
              <td className="num">{g.boards}</td>
              <td className="num len">
                {fmt(g.boardLength)} × {fmt(g.boardWidth)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Summary({ sheets, lumber, project }: { sheets: readonly SheetNesting[]; lumber: readonly LumberPlan[]; project: Project }) {
  const f = useOutputFormat();
  return (
    <table className="out-table sl-summary">
      <thead>
        <tr>
          <th>Material</th>
          <th>Stock</th>
          <th className="num">Qty</th>
          <th className="num">Yield</th>
          <th className="num">Not placed</th>
        </tr>
      </thead>
      <tbody>
        {sheets.map((n) => (
          <tr key={n.materialId}>
            <td>
              <Swatch color={colorOf(project, n.materialId)} />
              {n.materialName}
            </td>
            <td className="len">{n.length > 0 ? `${f.fmt(n.length)} × ${f.fmt(n.width)} sheet` : '—'}</td>
            <td className="num">{n.sheets.length}</td>
            <td className="num">{n.sheets.length ? pct(n.utilization) : '—'}</td>
            <td className={`num${n.unplaced.length ? ' bad' : ''}`}>{n.unplaced.length || ''}</td>
          </tr>
        ))}
        {lumber.map((l) => (
          <tr key={l.key}>
            <td>
              <Swatch color={colorOf(project, l.materialId)} />
              {l.materialName}
            </td>
            <td className="len">
              {f.fmt(l.thickness)} × {f.fmt(l.width)} boards
            </td>
            <td className="num">{l.boards.length}</td>
            <td className="num">{l.boards.length ? pct(l.utilization) : '—'}</td>
            <td className={`num${l.tooLong.length ? ' bad' : ''}`}>{l.tooLong.length || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sheets() {
  const { project, report, options } = useCutReport();
  const showCuts = useCutOptions((s) => s.showCutOrder);
  const setShowCuts = useCutOptions((s) => s.setShowCutOrder);
  const f = useOutputFormat();
  const sheetCount = report.sheets.reduce((n, s) => n + s.sheets.length, 0);
  const boardCount = report.lumber.reduce((n, l) => n + l.boards.length, 0);
  const maxLength = Math.max(1, ...options.lumber.stockLengths, ...report.lumber.flatMap((l) => l.boards.map((b) => b.stockLength)));
  const fitIssues = report.issues.filter((i) => FIT_CODES.has(i.code));
  const empty = report.sheets.length === 0 && report.lumber.length === 0;

  return (
    <div className="output-view out sheets">
      <OutputHeader
        title="Sheet layouts"
        subtitle={
          <>
            {project.name} · {plural(sheetCount, 'sheet')}, {plural(boardCount, 'board')}
            {report.shopping.boardFeet > 0 && ` (${f.bf(report.shopping.boardFeet)})`} · every cut runs edge to edge (table saw or track saw)
          </>
        }
      >
        <label className="toggle" title="Number the cuts in the order to make them: trims, then each stage across the pieces of the stage before">
          <input type="checkbox" checked={showCuts} onChange={(e) => setShowCuts(e.target.checked)} />
          Cut order
        </label>
        <PrintButton />
      </OutputHeader>
      <div className="sl-layout">
        <aside className="no-print">
          <OptionsPanel />
        </aside>
        <div className="sl-main">
          <IssueSummary issues={fitIssues} title="Parts that can't be laid out" />
          {empty ? (
            <p className="out-empty">No parts yet. Add boxes in the design view.</p>
          ) : (
            <>
              <Summary sheets={report.sheets} lumber={report.lumber} project={project} />
              {report.sheets.length > 0 && (
                <section className="out-section">
                  <h2>Sheet goods</h2>
                  {report.sheets.map((n) => (
                    <MaterialSheets key={n.materialId} nest={n} color={colorOf(project, n.materialId)} showCuts={showCuts} />
                  ))}
                </section>
              )}
              {report.lumber.length > 0 && (
                <section className="out-section">
                  <h2>Lumber</h2>
                  <p className="out-sub">
                    Boards cut to length from {options.lumber.stockLengths.map((s) => f.stock(s)).join(', ')} stock · kerf {f.fmt(options.lumber.kerf)} ·{' '}
                    {f.fmt(options.lumber.endTrim)} trimmed off each end
                  </p>
                  {report.lumber.map((l) => (
                    <LumberPlanView key={l.key} plan={l} color={colorOf(project, l.materialId)} maxLength={maxLength} />
                  ))}
                  {report.glueUps.length > 0 && <GlueUps list={report.glueUps} />}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function SheetsView() {
  return (
    <OutputBoundary>
      <Sheets />
    </OutputBoundary>
  );
}
