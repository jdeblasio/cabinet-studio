/** Shopping list: sheets, lumber, moldings, hardware and edge banding. Quantities only, no prices. */
import { EDGE_BANDING_ALLOWANCE } from '@built-in-planner/engine';
import { OutputBoundary, OutputHeader, pct, plural, PrintButton, Swatch, useOutputFormat } from './common';
import { useCutReport } from './state';
import './outputs.css';

/** Empty box to tick off in the shop (print). */
const Check = () => <td className="sh-check" aria-hidden />;

function Shopping() {
  const { project, report } = useCutReport();
  const f = useOutputFormat();
  const s = report.shopping;
  const color = (id: string) => project.materials.find((m) => m.id === id)?.color;
  const nothing = s.sheets.length + s.lumber.length + s.byLength.length + s.hardware.length + s.edgeBanding.length === 0;

  return (
    <div className="output-view out shopping">
      <OutputHeader title="Shopping list" subtitle={<>{project.name} · quantities only, no prices</>}>
        <PrintButton />
      </OutputHeader>

      {s.unplacedParts > 0 && (
        <div className="out-issues has-errors">
          <strong>{plural(s.unplacedParts, 'part')} not covered.</strong>{' '}
          <span className="muted">They don't fit a sheet or a stock board; see the cut list for what to change.</span>
        </div>
      )}
      {nothing && <p className="out-empty">Nothing to buy yet. Add boxes in the design view.</p>}

      {s.sheets.length > 0 && (
        <section className="out-section">
          <h2>Sheet goods</h2>
          <table className="out-table sh-table">
            <thead>
              <tr>
                <th className="sh-check" />
                <th>Material</th>
                <th className="num">Thickness</th>
                <th className="num">Sheet</th>
                <th className="num">Qty</th>
                <th className="num">Yield</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {s.sheets.map((l) => (
                <tr key={l.materialId}>
                  <Check />
                  <td>
                    <Swatch color={color(l.materialId)} />
                    {l.name}
                  </td>
                  <td className="num len">{f.fmt(l.thickness)}</td>
                  <td className="num len">{l.length > 0 ? `${f.fmt(l.length)} × ${f.fmt(l.width)}` : '—'}</td>
                  <td className="num qty">{l.count}</td>
                  <td className="num">{l.count ? pct(l.utilization) : '—'}</td>
                  <td className={l.unplaced ? 'bad' : 'muted'}>{l.unplaced ? `${plural(l.unplaced, 'part')} not placed, not counted` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {s.lumber.length > 0 && (
        <section className="out-section">
          <h2>Lumber</h2>
          <table className="out-table sh-table">
            <thead>
              <tr>
                <th className="sh-check" />
                <th>Material</th>
                <th className="num">Thick × wide</th>
                <th>Boards</th>
                <th className="num">Board feet</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {s.lumber.map((l) => (
                <tr key={`${l.materialId}|${l.thickness}|${l.width}`}>
                  <Check />
                  <td>
                    <Swatch color={color(l.materialId)} />
                    {l.name}
                  </td>
                  <td className="num len">
                    {f.fmt(l.thickness)} × {f.fmt(l.width)}
                  </td>
                  <td className="qty">{l.stock.map((st) => `${st.count} × ${f.stock(st.length)}`).join(', ') || '—'}</td>
                  <td className="num">{l.boardFeet.toFixed(2)}</td>
                  <td className={l.tooLong ? 'bad' : 'muted'}>{l.tooLong ? `${plural(l.tooLong, 'piece')} longer than any board, not counted` : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {s.lumberByMaterial.length > 1 &&
                s.lumberByMaterial.map((m) => (
                  <tr key={m.materialId} className="sub">
                    <td />
                    <td colSpan={3}>{m.name}</td>
                    <td className="num">{m.boardFeet.toFixed(2)}</td>
                    <td className="muted">{plural(m.boards, 'board')}</td>
                  </tr>
                ))}
              <tr>
                <td />
                <td colSpan={3}>Total</td>
                <td className="num">{s.boardFeet.toFixed(2)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <p className="out-foot muted">
            Boards are the rip width of the parts cut from them; buy wider boards and rip several strips if you like. Board feet are for that width and the
            actual thickness, so allow more for rough lumber.
          </p>
        </section>
      )}

      {s.byLength.length > 0 && (
        <section className="out-section">
          <h2>Moldings</h2>
          <table className="out-table sh-table">
            <thead>
              <tr>
                <th className="sh-check" />
                <th>Material</th>
                <th className="num">Profile</th>
                <th className="num">Pieces</th>
                <th className="num">Longest</th>
                <th className="num">Total length</th>
              </tr>
            </thead>
            <tbody>
              {s.byLength.map((l) => (
                <tr key={`${l.materialId}|${l.width}|${l.thickness}`}>
                  <Check />
                  <td>
                    <Swatch color={color(l.materialId)} />
                    {l.name}
                  </td>
                  <td className="num len">
                    {f.fmt(l.width)} × {f.fmt(l.thickness)}
                  </td>
                  <td className="num">{l.pieces}</td>
                  <td className="num len">{f.fmt(l.longest)}</td>
                  <td className="num qty">{f.long(l.length)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="out-foot muted">Net lengths; add for miters and waste.</p>
        </section>
      )}

      {(s.hardware.length > 0 || s.edgeBanding.length > 0) && (
        <section className="out-section">
          <h2>Hardware and edge banding</h2>
          <table className="out-table sh-table">
            <thead>
              <tr>
                <th className="sh-check" />
                <th>Item</th>
                <th className="num">Qty</th>
                <th>How it was estimated</th>
              </tr>
            </thead>
            <tbody>
              {s.hardware.map((h, i) => (
                <tr key={`${h.kind}${i}`}>
                  <Check />
                  <td>
                    {h.label}
                    {h.kind === 'drawerSlide' && (h.length ? `, ${f.fmt(h.length)}` : ', no length fits')}
                    {h.typeName && <div className="muted sh-type">{h.typeName}</div>}
                  </td>
                  <td className="num qty">
                    {h.qty} {h.unit === 'pair' ? (h.qty === 1 ? 'pair' : 'pairs') : ''}
                  </td>
                  <td className="muted">{h.basis}</td>
                </tr>
              ))}
              {s.edgeBanding.map((b) => (
                <tr key={`eb${b.thickness}`}>
                  <Check />
                  <td>Edge banding, {f.fmt(b.thickness)} wide</td>
                  <td className="num qty">{f.long(b.purchaseLength)}</td>
                  <td className="muted">
                    {f.long(b.length)} on {plural(b.edges, 'edge')} of {plural(b.parts, 'part')}, plus {f.fmt(EDGE_BANDING_ALLOWANCE)} per edge for trimming
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="out-foot muted">Hardware counts are rules of thumb; check them against the hinges and slides you choose.</p>
        </section>
      )}
    </div>
  );
}

export function ShoppingView() {
  return (
    <OutputBoundary>
      <Shopping />
    </OutputBoundary>
  );
}
