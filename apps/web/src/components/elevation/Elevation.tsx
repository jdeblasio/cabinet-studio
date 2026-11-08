import { inches, TICKS_PER_INCH, type Part, type Rect, type RunResult, type Ticks } from '@built-in-planner/engine';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { usePartColor } from '../../lib/colors';
import { useFormatter } from '../../lib/units';
import { useRunResult } from '../../store/derived';
import { sameSelection, selectionKey, type Selection } from '../../store/selection';
import { useActiveRun, useEditor } from '../../store/store';
import { computeHandles, hitChain, selectionRect, type BoundaryHandle } from './geometry';
import { solveDrag, type SnapGuide } from './snap';

/** World units in the SVG are inches; y is flipped (svg y = -world y). */
const I = (t: Ticks) => t / TICKS_PER_INCH;
const MIN_SIZE = inches(2);
/** Screen distance within which a dragged boundary snaps to an alignment target. */
const SNAP_PX = 8;
const FRONT_ROLES = new Set(['door', 'drawerFront', 'frontFrame', 'frontPanel']);

interface View {
  /** SVG-space coordinates of the top-left corner. */
  x: number;
  y: number;
  /** SVG units (inches) per screen pixel. */
  upp: number;
}

function fitView(result: RunResult, w: number, h: number): View {
  const W = Math.max(I(result.width), 12);
  const H = Math.max(I(result.ceilingHeight), 12);
  const margin = Math.max(W, H) * 0.08 + 6;
  const cw = W + margin * 2;
  const ch = H + margin * 2;
  const upp = Math.max(cw / Math.max(w, 1), ch / Math.max(h, 1));
  return { upp, x: W / 2 - (w * upp) / 2, y: -H / 2 - (h * upp) / 2 };
}

function rectToSvg(r: Rect) {
  return { x: I(r.x), y: -I(r.y + r.height), width: I(r.width), height: I(r.height) };
}

export function Elevation() {
  const run = useActiveRun();
  const result = useRunResult();
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const { fmt } = useFormatter();

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<Selection | null>(null);
  const [guide, setGuide] = useState<SnapGuide | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Until the user pans/zooms, keep the drawing fitted (on resize, run change, wall size change).
  const [autoFit, setAutoFit] = useState(true);
  useEffect(() => setAutoFit(true), [run.id]);
  const v = !autoFit && view ? view : fitView(result, size.w || 800, size.h || 500);
  const fit = useCallback(() => setAutoFit(true), []);
  const userView = useCallback(
    (next: View | ((prev: View) => View)) => {
      setAutoFit(false);
      setView(typeof next === 'function' ? next(v) : next);
    },
    [v],
  );

  /** Client point → world ticks. */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current!.getBoundingClientRect();
      const sx = v.x + (clientX - rect.left) * v.upp;
      const sy = v.y + (clientY - rect.top) * v.upp;
      return { x: sx * TICKS_PER_INCH, y: -sy * TICKS_PER_INCH };
    },
    [v],
  );

  // Wheel zoom around the cursor (non-passive listener so we can preventDefault).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      userView((cur) => {
        const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const upp = Math.min(Math.max(cur.upp * factor, 0.005), 5);
        const wx = cur.x + px * cur.upp;
        const wy = cur.y + py * cur.upp;
        return { upp, x: wx - px * upp, y: wy - py * upp };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [userView]);

  // Background pointer: pan when dragged, select when clicked.
  const lastClick = useRef<{ chainKey: string; selected: Selection } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; view: View; moved: boolean; pointerId: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, view: v, moved: e.button === 1, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (pan) {
      const dx = e.clientX - pan.startX;
      const dy = e.clientY - pan.startY;
      if (!pan.moved && Math.hypot(dx, dy) > 3) pan.moved = true;
      if (pan.moved) userView({ ...pan.view, x: pan.view.x - dx * pan.view.upp, y: pan.view.y - dy * pan.view.upp });
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    const top = hitChain(run, result, p.x, p.y)[0] ?? null;
    setHover((prev) => (sameSelection(prev, top) ? prev : top));
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    panRef.current = null;
    if (!pan || pan.moved) return;
    const p = toWorld(e.clientX, e.clientY);
    const chain = hitChain(run, result, p.x, p.y);
    const chainKey = chain.map(selectionKey).join('>');
    // Clicking the same spot again walks up a level; any other click selects the most specific element.
    const last = lastClick.current;
    const idx = last && last.chainKey === chainKey && sameSelection(last.selected, selection) ? chain.findIndex((c) => sameSelection(c, selection)) : -1;
    const next = idx >= 0 ? (chain[idx + 1] ?? chain[idx]!) : chain[0]!;
    lastClick.current = { chainKey, selected: next };
    select(next);
  };

  const parts = useMemo(
    () =>
      [...result.parts].sort(
        (a, b) => a.bounds.z + a.bounds.depth - (b.bounds.z + b.bounds.depth) || Number(FRONT_ROLES.has(a.role)) - Number(FRONT_ROLES.has(b.role)),
      ),
    [result.parts],
  );
  const colorOf = usePartColor();
  const handles = useMemo(() => computeHandles(run, result, MIN_SIZE), [run, result]);

  const W = I(result.width);
  const H = I(result.ceilingHeight);
  const px = v.upp; // one screen pixel in svg units
  const font = 11 * px;

  const selRect = selection ? selectionRect(result, selection) : undefined;
  const hoverRect = hover && !sameSelection(hover, selection) ? selectionRect(result, hover) : undefined;

  return (
    <div className="elevation" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="elevation-svg"
        width={size.w || 800}
        height={size.h || 500}
        viewBox={`${v.x} ${v.y} ${(size.w || 800) * v.upp} ${(size.h || 500) * v.upp}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        {/* Wall */}
        <rect x={0} y={-H} width={W} height={H} className="wall" />
        {result.tiers.map((t, i) => {
          const r = rectToSvg({ x: 0, y: t.y, width: result.width, height: t.height });
          return <rect key={t.tierId} {...r} className={`tier-band ${i % 2 ? 'odd' : ''} ${t.kind}`} />;
        })}
        {result.gaps.map((g) => (
          <rect key={g.spanId} {...rectToSvg(g.rect)} className="gap" />
        ))}

        {/* Parts, back to front */}
        <g className="parts">
          {parts.map((p) => (
            <PartRect key={p.id} part={p} color={colorOf(p)} />
          ))}
        </g>

        {/* Floor and ceiling */}
        <line x1={-W * 0.04} x2={W * 1.04} y1={0} y2={0} className="floor" />
        <line x1={0} x2={W} y1={-H} y2={-H} className="ceiling" />

        <Dimensions result={result} fmt={fmt} font={font} px={px} />

        {hoverRect && <rect {...rectToSvg(hoverRect)} className="hover-outline" />}
        {selRect && <rect key={selection ? selectionKey(selection) : ''} {...rectToSvg(selRect)} className="selection-outline" />}

        {guide &&
          (guide.axis === 'x' ? (
            <line className="snap-guide" x1={I(guide.pos)} x2={I(guide.pos)} y1={0} y2={-H} />
          ) : (
            <line className="snap-guide" x1={0} x2={W} y1={-I(guide.pos)} y2={-I(guide.pos)} />
          ))}

        <g className="handles">
          {handles.map((h) => (
            <HandleView key={h.key} handle={h} px={px} runId={run.id} onGuide={setGuide} />
          ))}
        </g>
      </svg>
      <div className="elevation-controls">
        <button onClick={fit} title="Fit to view">Fit</button>
      </div>
      {result.tiers.length === 0 && <div className="elevation-empty">Layout not available yet.</div>}
    </div>
  );
}

function PartRect({ part, color }: { part: Part; color: string }) {
  const b = part.bounds;
  const r = rectToSvg({ x: b.x, y: b.y, width: b.width, height: b.height });
  const front = FRONT_ROLES.has(part.role);
  return (
    <rect
      {...r}
      fill={color}
      className={`part role-${part.role}${front ? ' front' : ''}`}
      data-part={part.id}
    >
      <title>{part.name}</title>
    </rect>
  );
}

function Dimensions({ result, fmt, font, px }: { result: RunResult; fmt: (t: Ticks) => string; font: number; px: number }) {
  const W = I(result.width);
  const H = I(result.ceilingHeight);
  const off = 28 * px;
  const tick = 5 * px;
  return (
    <g className="dims" fontSize={font}>
      {/* Overall width above the ceiling */}
      <line x1={0} x2={W} y1={-H - off} y2={-H - off} />
      <line x1={0} x2={0} y1={-H - off - tick} y2={-H - off + tick} />
      <line x1={W} x2={W} y1={-H - off - tick} y2={-H - off + tick} />
      <text x={W / 2} y={-H - off - 4 * px} textAnchor="middle">
        {fmt(result.width)}
      </text>

      {/* Ceiling height on the right */}
      <line x1={W + off} x2={W + off} y1={0} y2={-H} />
      <text x={W + off + 4 * px} y={-H / 2} transform={`rotate(90 ${W + off + 4 * px} ${-H / 2})`} textAnchor="middle">
        {fmt(result.ceilingHeight)}
      </text>

      {/* Tier heights on the left */}
      {result.tiers.map((t) => {
        const y0 = -I(t.y);
        const y1 = -I(t.y + t.height);
        const cy = (y0 + y1) / 2;
        const x = -off;
        return (
          <g key={t.tierId}>
            <line x1={x} x2={x} y1={y0} y2={y1} />
            <line x1={x - tick} x2={x + tick} y1={y1} y2={y1} />
            <line x1={x - tick} x2={x + tick} y1={y0} y2={y0} />
            <text x={x - 4 * px} y={cy} transform={`rotate(-90 ${x - 4 * px} ${cy})`} textAnchor="middle">
              {fmt(t.height)}
            </text>
          </g>
        );
      })}

      {/* Carcass widths, near the top of each box (span boxes once, not per tier) */}
      {result.boxes.map((b) => {
        const top = -I(b.carcass.y + b.carcass.height);
        return (
          <text key={b.id} x={I(b.carcass.x + b.carcass.width / 2)} y={top + font * 2.6} textAnchor="middle" className="item-width">
            {fmt(b.carcass.width)}
          </text>
        );
      })}
    </g>
  );
}

function HandleView({
  handle,
  px,
  runId,
  onGuide,
}: {
  handle: BoundaryHandle;
  px: number;
  runId: string;
  onGuide: (guide: SnapGuide | null) => void;
}) {
  const beginDrag = useEditor((s) => s.beginDrag);
  const dragToProject = useEditor((s) => s.dragToProject);
  const endDrag = useEditor((s) => s.endDrag);
  const cancelDrag = useEditor((s) => s.cancelDrag);
  const grid = useEditor((s) => s.project.units.grid);
  const drag = useRef<{ startX: number; startY: number; handle: BoundaryHandle; upp: number } | null>(null);
  const [active, setActive] = useState(false);

  const thickness = 8 * px;
  const isX = handle.axis === 'x';
  const pos = I(handle.pos);
  const from = I(handle.from);
  const to = I(handle.to);
  const r = isX
    ? { x: pos - thickness / 2, y: -to, width: thickness, height: to - from }
    : { x: from, y: -pos - thickness / 2, width: to - from, height: thickness };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        drag.current = null;
        setActive(false);
        onGuide(null);
        cancelDrag();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, cancelDrag, onGuide]);

  return (
    <rect
      {...r}
      className={`handle handle-${handle.axis}${active ? ' active' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startY: e.clientY, handle, upp: px };
        setActive(true);
        beginDrag();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        e.stopPropagation();
        const screen = isX ? e.clientX - d.startX : -(e.clientY - d.startY);
        const world = screen * d.upp * TICKS_PER_INCH;
        const base = useEditor.getState().dragBase;
        if (!base) return;
        // Hold Alt/Option to drag freely without snapping.
        const sol = solveDrag(base, runId, d.handle, world, { grid, threshold: SNAP_PX * d.upp * TICKS_PER_INCH, snap: !e.altKey });
        dragToProject(sol.project);
        onGuide(sol.guide ?? null);
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        e.stopPropagation();
        drag.current = null;
        setActive(false);
        onGuide(null);
        endDrag();
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
        onGuide(null);
        cancelDrag();
      }}
    >
      {handle.snap && <title>Drag to resize. Snaps to edges in other tiers; hold Alt/Option to drag freely.</title>}
    </rect>
  );
}
