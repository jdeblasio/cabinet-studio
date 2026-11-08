/** Drawings for the sheet layouts view: one SVG per sheet, and lumber boards as bars. */
import { inches, type LumberBoard, type LumberOptions, type SheetLayout, type SheetNesting, type Ticks } from '@cabinet-studio/engine';
import { useId } from 'react';
import { useOutputFormat } from './common';
import { locateOwner } from './state';

const CHAR_W = 0.56; // average glyph width, in em
const LINE_H = 1.2;

/** Largest font (≤ max) at which `lines` fit a w × h box, horizontal or turned; null below `min`. */
function fitText(w: number, h: number, lines: string[], min: number, max: number): { fs: number; turned: boolean } | null {
  const chars = Math.max(...lines.map((l) => l.length), 1);
  const fit = (bw: number, bh: number) => Math.min(max, (bw * 0.88) / (chars * CHAR_W), (bh * 0.8) / (lines.length * LINE_H));
  const flat = fit(w, h);
  const turned = fit(h, w);
  const best = turned > flat * 1.15 ? { fs: turned, turned: true } : { fs: flat, turned: false };
  return best.fs >= min ? best : null;
}

function Label({ x, y, w, h, options, className }: { x: number; y: number; w: number; h: number; options: string[][]; className: string }) {
  for (const lines of options) {
    const fit = fitText(w, h, lines, inches(1.3), inches(2.6));
    if (!fit) continue;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const top = cy - ((lines.length - 1) * LINE_H * fit.fs) / 2;
    return (
      <text className={className} fontSize={fit.fs} transform={fit.turned ? `rotate(-90 ${cx} ${cy})` : undefined} textAnchor="middle" dominantBaseline="central">
        {lines.map((l, i) => (
          <tspan key={i} x={cx} y={top + i * LINE_H * fit.fs} className={i === 0 ? 'first' : undefined}>
            {l}
          </tspan>
        ))}
      </text>
    );
  }
  return null;
}

export function SheetDiagram({ nest, sheet, color, showCuts }: { nest: SheetNesting; sheet: SheetLayout; color: string; showCuts: boolean }) {
  const { fmt } = useOutputFormat();
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const L = nest.length;
  const W = nest.width;
  const u = nest.usable;
  const size = (t: Ticks) => fmt(t, { showUnits: false });
  return (
    <svg className="sheet-svg" viewBox={`0 0 ${L} ${W}`} role="img" aria-label={`Sheet ${sheet.index + 1} of ${nest.materialName}`}>
      <defs>
        <pattern id={hatch} patternUnits="userSpaceOnUse" width={inches(1)} height={inches(1)} patternTransform="rotate(45)">
          <rect width={inches(1)} height={inches(1)} className="hatch-bg" />
          <line x1={0} y1={0} x2={0} y2={inches(1)} className="hatch-line" strokeWidth={inches(0.12)} />
        </pattern>
      </defs>
      {/* Trim shows as hatched border around the usable area. */}
      <rect x={0} y={0} width={L} height={W} fill={`url(#${hatch})`} />
      {u && <rect className="sheet-usable" x={u.x} y={u.y} width={u.w} height={u.h} />}
      {sheet.offcuts.map((o, i) => (
        <g key={`o${i}`} className="sheet-offcut">
          <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={`url(#${hatch})`} />
          {Math.min(o.w, o.h) >= inches(4) && <Label x={o.x} y={o.y} w={o.w} h={o.h} options={[[`${size(o.w)} × ${size(o.h)}`]]} className="offcut-text" />}
        </g>
      ))}
      {sheet.cuts.map((c) => (
        <rect key={`k${c.step}`} className="sheet-kerf" x={c.kerf.x} y={c.kerf.y} width={c.kerf.w} height={c.kerf.h} />
      ))}
      {sheet.placements.map((p) => (
        <g key={p.part.key} className="sheet-part" onClick={() => locateOwner(p.part)}>
          <title>
            {`${p.label}: ${p.part.name} — ${fmt(p.part.length)} × ${fmt(p.part.width)}${p.rotated ? ' (turned across the sheet)' : ''}. Click to show in the design.`}
          </title>
          <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={color} />
          <Label
            x={p.x}
            y={p.y}
            w={p.w}
            h={p.h}
            options={[
              [`${p.label} ${p.part.name}`, `${size(p.part.length)} × ${size(p.part.width)}`],
              [p.label, `${size(p.part.length)} × ${size(p.part.width)}`],
              [p.label],
            ]}
            className="part-text"
          />
        </g>
      ))}
      {showCuts &&
        sheet.cuts.map((c) => {
          const r = inches(1.1);
          // Keep the marker inside the sheet (trim cuts run along its edges).
          const clamp = (v: number, max: number) => Math.min(Math.max(v, r), max - r);
          const mx = clamp((c.x1 + c.x2) / 2, L);
          const my = clamp((c.y1 + c.y2) / 2, W);
          return (
            <g key={`c${c.step}`} className={`sheet-cut stage-${Math.min(c.stage, 3)}`}>
              <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} />
              <circle cx={mx} cy={my} r={r} />
              <text x={mx} y={my} fontSize={r * 1.15} textAnchor="middle" dominantBaseline="central">
                {c.step}
              </text>
            </g>
          );
        })}
      <rect className="sheet-outline" x={0} y={0} width={L} height={W} />
    </svg>
  );
}

/** One lumber board as a bar: end trims, pieces (row label and length) and the offcut. */
export function BoardBar({ board, maxLength, color, opts }: { board: LumberBoard; maxLength: Ticks; color: string; opts: LumberOptions }) {
  const f = useOutputFormat();
  const L = board.stockLength;
  const at = (t: Ticks) => `${(t / L) * 100}%`;
  const lastEnd = board.cuts.reduce((m, c) => Math.max(m, c.offset + c.piece.length), opts.endTrim);
  return (
    <div className="lb-board">
      <div className="lb-stock">{f.stock(L)}</div>
      <div className="lb-track">
        <div className="lb-bar" style={{ width: `${(L / maxLength) * 100}%` }}>
          {opts.endTrim > 0 && <div className="lb-trim" style={{ left: 0, width: at(opts.endTrim) }} />}
          {board.cuts.map((c, i) => (
            <div
              key={i}
              className="lb-piece"
              style={{ left: at(c.offset), width: at(c.piece.length), background: color }}
              title={`${c.piece.label}: ${c.piece.part.name} — ${f.fmt(c.piece.length)}${c.piece.strip ? ` (glue-up strip ${c.piece.strip.index} of ${c.piece.strip.of})` : ''}`}
              onClick={() => locateOwner(c.piece.part)}
            >
              <span>
                <b>{c.piece.label}</b> {f.fmt(c.piece.length)}
              </span>
            </div>
          ))}
          {board.offcut > 0 && (
            <div className="lb-offcut" style={{ left: at(lastEnd + opts.kerf), width: at(board.offcut) }} title={`Offcut ${f.fmt(board.offcut)}`}>
              <span>{f.fmt(board.offcut)}</span>
            </div>
          )}
          {opts.endTrim > 0 && <div className="lb-trim" style={{ right: 0, width: at(opts.endTrim) }} />}
        </div>
      </div>
    </div>
  );
}
