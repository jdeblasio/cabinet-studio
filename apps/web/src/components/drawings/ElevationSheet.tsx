import type { Id, Part, Run, RunResult, Ticks, UnitSystem } from '@cabinet-studio/engine';
import { useMemo } from 'react';
import { chainPads } from './dimensions';
import { elevationChains, frontLeaves, type FrontLeaf } from './elevation';
import { frontToBack, roleClass, type BoxLabel } from './parts';
import { AREA, VIEW, fitViews, projection, type Proj } from './scale';
import type { SectionCut } from './section';
import { Sheet, SheetSvg, type SheetMeta } from './Sheet';
import { Bubble, Chains, Patterns, paperRect, useSvgId } from './svg';

interface Props {
  meta: SheetMeta;
  run: Run;
  result: RunResult;
  labels: Map<Id, BoxLabel>;
  cuts: readonly SectionCut[];
  fmt: (t: Ticks) => string;
  system: UnitSystem;
}

/** Front elevation of a run: every part as a line drawing, gaps by name, section marks and dimension chains. */
export function ElevationSheet({ meta, run, result, labels, cuts, fmt, system }: Props) {
  const id = useSvgId();
  const W = result.width;
  const H = result.ceilingHeight;
  const wallL = run.ends.left === 'wall';
  const wallR = run.ends.right === 'wall';
  const P = VIEW.poche;

  const layout = useMemo(() => {
    const chains = elevationChains(result);
    const inset = { left: wallL ? P : 0, right: wallR ? P : 0, top: cuts.length ? VIEW.marker : 0 };
    const clear = { left: inset.left, right: inset.right };
    const pad = chainPads(chains, inset);
    const fit = fitViews([{ w: Math.max(W, 1), h: Math.max(H, 1), pad }], AREA, { dir: 'row', gap: 0, system });
    const placed = fit.views[0]!;
    return { chains, inset, clear, scale: fit.scale, placed, proj: projection(placed, fit.scale.k, { u0: 0, v0: 0, v1: H }, true) };
  }, [result, wallL, wallR, P, cuts.length, W, H, system]);
  const { chains, inset, clear, scale, placed, proj } = layout;

  const leaves = useMemo(() => frontLeaves(result), [result]);
  const floorY = proj.y(0);
  const ceilY = proj.y(H);

  return (
    <Sheet meta={meta} scale={scale}>
      <SheetSvg label={`Front elevation of ${run.name}`}>
        <Patterns id={id} />
        <g className="elevation-view">
          {wallL && <rect className="poche" x={placed.x - P} y={ceilY} width={P} height={floorY - ceilY} fill={`url(#${id}-poche)`} />}
          {wallR && <rect className="poche" x={placed.x + placed.w} y={ceilY} width={P} height={floorY - ceilY} fill={`url(#${id}-poche)`} />}
          {wallL && <line className="wall-face" x1={placed.x} x2={placed.x} y1={ceilY} y2={floorY} />}
          {wallR && <line className="wall-face" x1={placed.x + placed.w} x2={placed.x + placed.w} y1={ceilY} y2={floorY} />}
          <line className="ceiling-line" x1={placed.x} x2={placed.x + placed.w} y1={ceilY} y2={ceilY} />

          {result.gaps.map((g) => {
            const r = paperRect(proj, g.rect.x, g.rect.y, g.rect.width, g.rect.height);
            const name = run.spans.find((s) => s.id === g.spanId)?.name?.trim() || 'Gap';
            return (
              <g key={g.spanId} className="gap">
                <rect className="gap-rect" {...r} />
                <text className="gap-label" x={r.x + r.width / 2} y={r.y + r.height / 2} textAnchor="middle">
                  {name}
                </text>
              </g>
            );
          })}

          <ElevationParts parts={result.parts} leaves={leaves} proj={proj} />

          <line className="floor-line" x1={placed.x - (wallL ? P : 6)} x2={placed.x + placed.w + (wallR ? P : 6)} y1={floorY} y2={floorY} />
        </g>

        <Chains chains={chains} proj={proj} placed={placed} fmt={fmt} inset={inset} clear={clear} />

        {result.boxes.map((b) => {
          const label = labels.get(b.id);
          if (!label) return null;
          const c = b.carcass;
          return <Bubble key={b.id} x={proj.x(c.x + c.width / 2)} y={proj.y(c.y + c.height) + 7.5} r={4.6} text={String(label.num)} className="box-tag" />;
        })}

        {cuts.map((cut) => {
          const x = proj.x(cut.x);
          const by = placed.y - VIEW.marker / 2 - 1;
          return (
            <g key={cut.label} className="section-mark">
              <line className="cut-line" x1={x} x2={x} y1={by + 5} y2={floorY} />
              <polygon className="cut-arrow" points={`${x + 5.6},${by - 2.6} ${x + 9.4},${by} ${x + 5.6},${by + 2.6}`} />
              <Bubble x={x} y={by} r={5} text={cut.label} />
            </g>
          );
        })}
      </SheetSvg>
    </Sheet>
  );
}

/** Parts as a front-view line drawing (painted back to front), with hinge-side marks on doors. */
export function ElevationParts({ parts, leaves, proj }: { parts: readonly Part[]; leaves: readonly FrontLeaf[]; proj: Proj }) {
  const sorted = useMemo(() => frontToBack(parts), [parts]);
  return (
    <>
      <g className="parts">
        {sorted.map((p) => (
          <rect key={p.id} className={`part pc-${roleClass(p.role)} role-${p.role}`} {...paperRect(proj, p.bounds.x, p.bounds.y, p.bounds.width, p.bounds.height)} />
        ))}
      </g>
      <Swings leaves={leaves} proj={proj} />
    </>
  );
}

/** Hinge-side marks: dashed lines from the latch-side corners to the middle of the hinged edge. */
export function Swings({ leaves, proj }: { leaves: readonly FrontLeaf[]; proj: Proj }) {
  return (
    <g className="swings">
      {leaves.map((l, i) => {
        if (l.kind !== 'door') return null;
        const r = paperRect(proj, l.rect.x, l.rect.y, l.rect.width, l.rect.height);
        const hingeX = l.hinge === 'right' ? r.x + r.width : r.x;
        const latchX = l.hinge === 'right' ? r.x : r.x + r.width;
        const inset = Math.min(r.width, r.height) * 0.04;
        const lx = latchX + (l.hinge === 'right' ? inset : -inset);
        const hx = hingeX + (l.hinge === 'right' ? -inset : inset);
        return <polyline key={`${l.sectionId}-${i}`} className="swing" points={`${lx},${r.y + inset} ${hx},${r.y + r.height / 2} ${lx},${r.y + r.height - inset}`} />;
      })}
    </g>
  );
}
