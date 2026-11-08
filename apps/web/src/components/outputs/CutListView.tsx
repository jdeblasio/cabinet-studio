/** Cut list: every part to cut, grouped by material and size, with CSV export and print. */
import { cutListCsv, describeRowNote, type CutListGroup, type CutListRow, type RowNote } from '@cabinet-studio/engine';
import { IssueSummary, OutputBoundary, OutputHeader, PrintButton, plural, Swatch, useOutputFormat } from './common';
import { locateOwner, useCutReport } from './state';
import './outputs.css';

const PROBLEM_NOTES: ReadonlySet<RowNote['kind']> = new Set(['exceedsSheet', 'tooLong', 'noStock', 'noSheetSize', 'missingMaterial']);

function download(filename: string, text: string, type: string): void {
  // The BOM lets spreadsheet apps read the UTF-8 (×, ″) correctly.
  const blob = new Blob(['﻿', text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'project';

function Row({ row, showFinish }: { row: CutListRow; showFinish: boolean }) {
  const { fmt } = useOutputFormat();
  const mismatch = row.notes.some((n) => n.kind === 'thicknessMismatch');
  const problem = row.notes.some((n) => PROBLEM_NOTES.has(n.kind));
  const first = row.owners[0];
  return (
    <tr
      className={`cl-row${problem ? ' problem' : ''}${first ? ' locatable' : ''}`}
      title={first ? `Show ${first.label} in the design` : undefined}
      onClick={() => first && locateOwner(first)}
    >
      <td className="cl-label">{row.label}</td>
      <td className="num">{row.qty}</td>
      <td className="cl-names">{row.names.join(', ')}</td>
      {showFinish && (
        <td className="cl-finish">
          {row.finish ? (
            <>
              <Swatch color={row.finish.color} />
              {row.finish.name}
            </>
          ) : (
            <span className="muted">Natural</span>
          )}
        </td>
      )}
      <td className="num len">{fmt(row.length)}</td>
      <td className="num len">{fmt(row.width)}</td>
      <td className={`num len${mismatch ? ' warn' : ''}`}>{fmt(row.thickness)}</td>
      <td className="cl-grain">{row.byLength ? 'By length' : row.grain === 'length' ? 'Along L' : 'Any'}</td>
      <td className="cl-owners">
        {row.owners.map((o, i) => (
          <span key={`${o.runId}:${o.ownerId}`}>
            {i > 0 && ', '}
            <button
              className="link"
              onClick={(e) => {
                e.stopPropagation();
                locateOwner(o);
              }}
            >
              {o.label}
            </button>
          </span>
        ))}
      </td>
      <td className="cl-notes">
        {[...(row.byLength ? ['Bought by length'] : []), ...row.partNotes].map((n) => (
          <div key={n}>{n}</div>
        ))}
        {row.notes.map((n, i) => (
          <div key={i} className={PROBLEM_NOTES.has(n.kind) ? 'bad' : n.kind === 'thicknessMismatch' ? 'warn' : ''}>
            {describeRowNote(n, fmt)}
          </div>
        ))}
      </td>
    </tr>
  );
}

function GroupTable({ group }: { group: CutListGroup }) {
  const f = useOutputFormat();
  const showFinish = group.rows.some((r) => r.finish);
  const summary =
    group.kind === 'sheet'
      ? `${plural(group.parts, 'part')} · ${f.area(group.area)}`
      : group.kind === 'lumber'
        ? `${plural(group.parts, 'part')} · ${f.long(group.linear)}${group.boardFeet > 0 ? ` · ${f.bf(group.boardFeet)} net` : ''}`
        : plural(group.parts, 'part');
  return (
    <section className="out-group">
      <h3>
        <Swatch color={group.material?.color} />
        {group.name}
        {group.material && <span className="out-group-meta">· {f.fmt(group.material.thickness)}</span>}
        <span className="out-group-sum">{summary}</span>
      </h3>
      <table className="out-table cl-table">
        <thead>
          <tr>
            <th className="cl-label" title="Reference used on the sheet layouts">#</th>
            <th className="num">Qty</th>
            <th>Part</th>
            {showFinish && <th title="Paint or finish (Construction › finish rows)">Finish</th>}
            <th className="num" title="Along the grain">Length</th>
            <th className="num" title="Across the grain">Width</th>
            <th className="num">Thick</th>
            <th>Grain</th>
            <th>Boxes</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r) => (
            <Row key={r.label} row={r} showFinish={showFinish} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CutList() {
  const { project, report } = useCutReport();
  const f = useOutputFormat();
  const cl = report.cutList;
  const t = cl.totals;
  const sections: [string, CutListGroup[]][] = [
    ['Sheet goods', cl.sheetGoods],
    ['Lumber', cl.lumber],
    ['Unknown material', cl.unknown],
  ];
  const onCsv = () => download(`${safeName(project.name)} - cut list.csv`, cutListCsv(cl, (x) => f.fmt(x)), 'text/csv;charset=utf-8');

  return (
    <div className="output-view out cutlist">
      <OutputHeader
        title="Cut list"
        subtitle={
          <>
            {project.name} · {plural(t.parts, 'part')} in {plural(t.rows, 'row')}
            {t.sheetArea > 0 && <> · {f.area(t.sheetArea)} of sheet goods</>}
            {t.lumberLength > 0 && <> · {f.long(t.lumberLength)} of lumber</>}
          </>
        }
      >
        <button onClick={onCsv} disabled={t.rows === 0} title="Download the cut list as a CSV file (opens in any spreadsheet)">
          Download CSV
        </button>
        <PrintButton />
      </OutputHeader>
      <IssueSummary issues={report.issues} />
      {t.parts === 0 && <p className="out-empty">No parts yet. Add boxes in the design view.</p>}
      {sections.map(
        ([title, groups]) =>
          groups.length > 0 && (
            <section key={title} className="out-section">
              <h2>{title}</h2>
              {groups.map((g) => (
                <GroupTable key={g.materialId} group={g} />
              ))}
            </section>
          ),
      )}
      {t.parts > 0 && (
        <p className="out-foot muted">
          Sizes are finished sizes: length along the grain, width across it. Click a row to show its box in the design.
        </p>
      )}
    </div>
  );
}

export function CutListView() {
  return (
    <OutputBoundary>
      <CutList />
    </OutputBoundary>
  );
}
