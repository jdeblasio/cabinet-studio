/**
 * Read-only 2D views of the active run or island: from the left end, the right end, or the top.
 * Parts are drawn back to front as flat rectangles in their colors; an island shows both faces.
 * Clicking a part selects its box (on whichever face it belongs to).
 */
import { TICKS_PER_INCH, type Bounds, type Part, type Ticks } from '@cabinet-studio/engine';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePartColor } from '../../lib/colors';
import { useFormatter } from '../../lib/units';
import { getRunResult } from '../../store/derived';
import { selectionForId } from '../../store/selection';
import { useActiveRun, useEditor, type DesignView } from '../../store/store';

const I = (t: Ticks) => t / TICKS_PER_INCH;
/** Wall thickness drawn behind wall runs (inches). */
const WALL = 4;

type Side = Exclude<DesignView, 'elevation'>;

/** A part's footprint in the view: u across, v up (side views) or toward the front (top view), plus a depth key (larger = nearer). */
function footprint(b: Bounds, view: Side): { u0: number; u1: number; v0: number; v1: number; near: number } {
  if (view === 'top') return { u0: I(b.x), u1: I(b.x + b.width), v0: I(b.z), v1: I(b.z + b.depth), near: I(b.y + b.height) };
  // From the left end (looking toward +x) the front is on the right; from the right end, on the left.
  if (view === 'left') return { u0: I(b.z), u1: I(b.z + b.depth), v0: I(b.y), v1: I(b.y + b.height), near: -I(b.x) };
  return { u0: -I(b.z + b.depth), u1: -I(b.z), v0: I(b.y), v1: I(b.y + b.height), near: I(b.x + b.width) };
}

export const VIEW_TITLES: Record<Side, string> = {
  left: 'From the left end',
  right: 'From the right end',
  top: 'From above',
};

export function ProjectionView({ view }: { view: Side }) {
  const run = useActiveRun();
  const project = useEditor((s) => s.project);
  const select = useEditor((s) => s.select);
  const setActiveRun = useEditor((s) => s.setActiveRun);
  const showWalls = useEditor((s) => s.showWalls) && run.kind !== 'island';
  const colorOf = usePartColor();
  const { fmt } = useFormatter();
  // An island is drawn whole: its main run carries the back face, mirrored into place.
  const mainId = run.islandOf ?? run.id;
  const result = getRunResult(project, mainId);
  const backId = result.island?.backRunId;
  const backParts = useMemo(() => new Set(result.island?.parts.map((p) => p.id) ?? []), [result]);
  const parts = useMemo(() => {
    const all: Part[] = [...result.parts, ...(result.island?.parts ?? [])];
    return all.map((p) => ({ p, r: footprint(p.bounds, view) })).sort((a, b) => a.r.near - b.r.near);
  }, [result, view]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (parts.length === 0) return <div className="elevation-empty">Nothing to show yet.</div>;

  // Extents, with the wall (and the ceiling, from the side) for wall runs.
  const H = I(result.ceilingHeight);
  let u0 = Math.min(...parts.map((x) => x.r.u0));
  let u1 = Math.max(...parts.map((x) => x.r.u1));
  let v0 = Math.min(0, ...parts.map((x) => x.r.v0));
  let v1 = Math.max(...parts.map((x) => x.r.v1));
  if (showWalls) {
    if (view === 'left') u0 = Math.min(u0, -WALL);
    if (view === 'right') u1 = Math.max(u1, WALL);
    if (view === 'top') v0 = Math.min(v0, -WALL);
    else v1 = Math.max(v1, H);
  }
  // The parts' own extents, for the dimensions.
  const pU0 = Math.min(...parts.map((x) => x.r.u0));
  const pU1 = Math.max(...parts.map((x) => x.r.u1));
  const pV0 = Math.min(...parts.map((x) => x.r.v0));
  const pV1 = Math.max(...parts.map((x) => x.r.v1));
  const W = u1 - u0;
  const Hh = v1 - v0;
  const margin = Math.max(W, Hh) * 0.1 + 6;
  const upp = Math.max((W + 2 * margin) / Math.max(size.w, 1), (Hh + 2 * margin) / Math.max(size.h, 1));
  // Side views have y up (svg y = -v); the top view has the front toward the bottom (svg y = v).
  const sy = (v: number) => (view === 'top' ? v : -v);
  const cx = (u0 + u1) / 2;
  const cy = (sy(v0) + sy(v1)) / 2;
  const box = { x: cx - (size.w * upp) / 2, y: cy - (size.h * upp) / 2, w: size.w * upp, h: size.h * upp };
  const px = upp;
  const font = 11 * px;
  const rect = (a: number, b: number, c: number, d: number) => ({ x: Math.min(a, b), y: Math.min(sy(c), sy(d)), width: Math.abs(b - a), height: Math.abs(sy(d) - sy(c)) });

  const onPick = (p: Part) => {
    const runId = backId && backParts.has(p.id) ? backId : mainId;
    const target = project.runs.find((r) => r.id === runId);
    if (!target) return;
    const sel = selectionForId(target, p.ownerId, getRunResult(project, runId));
    if (!sel) return;
    if (runId !== run.id) setActiveRun(runId);
    select(sel);
  };

  const dimY = sy(view === 'top' ? v1 : v0) + (view === 'top' ? 1 : 1) * 22 * px;
  const dimX = u1 + 22 * px;
  return (
    <div className="elevation projection" ref={wrapRef}>
      <svg className="elevation-svg" width={size.w} height={size.h} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
        {showWalls && view === 'left' && <rect {...rect(-WALL, 0, 0, H)} className="wall section-wall" />}
        {showWalls && view === 'right' && <rect {...rect(0, WALL, 0, H)} className="wall section-wall" />}
        {showWalls && view === 'top' && <rect {...rect(u0, u1, -WALL, 0)} className="wall section-wall" />}
        {view !== 'top' && <line x1={u0 - margin / 2} x2={u1 + margin / 2} y1={0} y2={0} className="floor" />}
        {showWalls && view !== 'top' && <line x1={u0} x2={u1} y1={-H} y2={-H} className="ceiling" />}
        <g className="parts">
          {parts.map(({ p, r }) =>
            // From above, a countertop is an outline so the boxes under it show.
            view === 'top' && p.role === 'countertop' ? null : (
              <rect key={p.id} {...rect(r.u0, r.u1, r.v0, r.v1)} fill={colorOf(p)} className={`part role-${p.role}`} onClick={() => onPick(p)} style={{ cursor: 'pointer' }}>
                <title>{p.name}</title>
              </rect>
            ),
          )}
          {view === 'top' &&
            parts
              .filter(({ p }) => p.role === 'countertop')
              .map(({ p, r }) => (
                <rect key={p.id} {...rect(r.u0, r.u1, r.v0, r.v1)} className="countertop-outline">
                  <title>{p.name}</title>
                </rect>
              ))}
        </g>
        <g className="dims" fontSize={font}>
          <line x1={pU0} x2={pU1} y1={dimY} y2={dimY} />
          <text x={(pU0 + pU1) / 2} y={dimY + font * 1.2} textAnchor="middle">
            {fmt(Math.round((pU1 - pU0) * TICKS_PER_INCH))}
          </text>
          <line x1={dimX} x2={dimX} y1={sy(view === 'top' ? pV0 : 0)} y2={sy(pV1)} />
          <text x={dimX + 4 * px} y={(sy(view === 'top' ? pV0 : 0) + sy(pV1)) / 2} transform={`rotate(90 ${dimX + 4 * px} ${(sy(view === 'top' ? pV0 : 0) + sy(pV1)) / 2})`} textAnchor="middle">
            {fmt(Math.round((pV1 - (view === 'top' ? pV0 : 0)) * TICKS_PER_INCH))}
          </text>
        </g>
      </svg>
      <div className="projection-label muted">{VIEW_TITLES[view]} · click a part to select its box</div>
    </div>
  );
}
