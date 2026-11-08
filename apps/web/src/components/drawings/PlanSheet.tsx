import type { Id, Run, RunResult, Ticks, UnitSystem } from '@cabinet-studio/engine';
import { useMemo } from 'react';
import { chainPads } from './dimensions';
import type { BoxLabel } from './parts';
import { planChains, planTiers, type PlanRect } from './plan';
import { AREA, VIEW, fitViews, projection, type Proj } from './scale';
import { Sheet, SheetSvg, type SheetMeta } from './Sheet';
import { Bubble, Chains, Patterns, paperRect, useSvgId } from './svg';

interface Props {
  meta: SheetMeta;
  run: Run;
  result: RunResult;
  labels: Map<Id, BoxLabel>;
  fmt: (t: Ticks) => string;
  system: UnitSystem;
}

const CAPTION = 13;
const LEGEND = 14;

/** Plan (top down) of each box tier, stacked bottom tier first, all at one scale and aligned along the run. */
export function PlanSheet({ meta, run, result, labels, fmt, system }: Props) {
  const id = useSvgId();
  const wallL = run.ends.left === 'wall';
  const wallR = run.ends.right === 'wall';
  const P = VIEW.poche;

  const layout = useMemo(() => {
    const items = planTiers(result).map((plan) => {
      const chains = planChains(result, plan);
      const inset = { left: wallL ? P : 0, right: wallR ? P : 0 };
      const pad = chainPads(chains, inset);
      return { plan, chains, inset, need: { w: Math.max(result.width, 1), h: Math.max(plan.depth, 1), pad: { ...pad, top: pad.top + P + CAPTION } } };
    });
    const fit = fitViews(
      items.map((i) => i.need),
      { w: AREA.w, h: AREA.h - LEGEND },
      { dir: 'column', gap: 10, system },
    );
    return { items, scale: fit.scale, placed: fit.views };
  }, [result, wallL, wallR, P, system]);

  return (
    <Sheet meta={meta} scale={layout.scale}>
      <SheetSvg label={`Plan of ${run.name}`}>
        <Patterns id={id} />
        {layout.items.map((item, i) => {
          const placed = layout.placed[i]!;
          const { plan } = item;
          const proj = projection(placed, layout.scale.k, { u0: 0, v0: 0, v1: plan.depth }, false);
          const R = (r: PlanRect) => paperRect(proj, r.x, r.z, r.width, r.depth);
          const tierName = run.tiers.find((t) => t.id === plan.tier.tierId)?.name ?? 'Tier';
          const x0 = placed.x - (wallL ? P : 0);
          const x1 = placed.x + placed.w + (wallR ? P : 0);
          const wallY = placed.y;
          return (
            <g key={plan.tier.tierId} className="plan-view">
              <text className="view-caption" x={placed.x} y={wallY - P - 4}>
                {tierName} plan
              </text>
              <rect className="poche" x={x0} y={wallY - P} width={x1 - x0} height={P} fill={`url(#${id}-poche)`} />
              {wallL && <rect className="poche" x={placed.x - P} y={wallY} width={P} height={placed.h} fill={`url(#${id}-poche)`} />}
              {wallR && <rect className="poche" x={placed.x + placed.w} y={wallY} width={P} height={placed.h} fill={`url(#${id}-poche)`} />}
              <line className="wall-face" x1={x0} x2={x1} y1={wallY} y2={wallY} />
              {wallL && <line className="wall-face" x1={placed.x} x2={placed.x} y1={wallY} y2={wallY + placed.h} />}
              {wallR && <line className="wall-face" x1={placed.x + placed.w} x2={placed.x + placed.w} y1={wallY} y2={wallY + placed.h} />}

              {plan.countertops.map((r, j) => (
                <rect key={`c${j}`} className="plan-counter" {...R(r)} />
              ))}
              {plan.gaps.map((g) => {
                const r = R({ x: g.x, z: 0, width: g.width, depth: plan.tier.depth });
                const name = run.spans.find((s) => s.id === g.spanId)?.name?.trim() || 'Gap';
                return (
                  <g key={g.spanId}>
                    <rect className="gap-rect" {...r} />
                    <text className="gap-label" x={r.x + r.width / 2} y={r.y + r.height / 2 + 2.5} textAnchor="middle">
                      {name}
                    </text>
                  </g>
                );
              })}
              {plan.boxes.map((b) => (
                <rect key={b.id} className="plan-carcass" {...R(b.rect)} />
              ))}
              {plan.frame.map((r, j) => (
                <rect key={`f${j}`} className="plan-frame" {...R(r)} />
              ))}
              {plan.fronts.map((r, j) => (
                <rect key={`d${j}`} className="plan-front" {...R(r)} />
              ))}
              {plan.trim.map((r, j) => (
                <rect key={`t${j}`} className="plan-trim" {...R(r)} />
              ))}
              {plan.kicks.map((r, j) => (
                <rect key={`k${j}`} className="plan-kick" {...R(r)} />
              ))}
              <Tags boxes={plan.boxes} labels={labels} proj={proj} />
              <Chains chains={item.chains} proj={proj} placed={placed} fmt={fmt} inset={item.inset} clear={item.inset} />
            </g>
          );
        })}
        {layout.items.length > 0 && <PlanLegend y={AREA.h - 3} />}
      </SheetSvg>
    </Sheet>
  );
}

function Tags({ boxes, labels, proj }: { boxes: { id: Id; rect: PlanRect }[]; labels: Map<Id, BoxLabel>; proj: Proj }) {
  return (
    <>
      {boxes.map((b) => {
        const label = labels.get(b.id);
        if (!label) return null;
        return <Bubble key={b.id} x={proj.x(b.rect.x + b.rect.width / 2)} y={proj.y(b.rect.z + b.rect.depth / 2)} r={4.6} text={String(label.num)} className="box-tag" />;
      })}
    </>
  );
}

function PlanLegend({ y }: { y: number }) {
  return (
    <g className="legend" transform={`translate(2 ${y})`}>
      <rect className="plan-counter" x={0} y={-6} width={12} height={6} />
      <text x={16} y={-0.8}>Countertop</text>
      <rect className="plan-kick" x={68} y={-6} width={12} height={6} />
      <text x={84} y={-0.8}>Toe kick (under)</text>
      <rect className="plan-front" x={150} y={-6} width={12} height={6} />
      <text x={166} y={-0.8}>Face frame / fronts</text>
    </g>
  );
}
