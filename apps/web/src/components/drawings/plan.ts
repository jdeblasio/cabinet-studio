/**
 * Plan view (top down), one footprint per tier. World axes in a plan: u = x along the run,
 * v = z out from the wall (the wall is at the top of the page, the room below).
 */
import type { Id, Part, RunResult, Ticks, TierLayout } from '@built-in-planner/engine';
import { compactChains, type Chain, type ChainPoint } from './dimensions';
import { isFrame, roleClass } from './parts';
import { isKickFront } from './section';

/** A rectangle in plan: x along the run, z out from the wall. */
export interface PlanRect {
  x: Ticks;
  z: Ticks;
  width: Ticks;
  depth: Ticks;
}

export interface PlanTier {
  tier: TierLayout;
  /** Carcass footprints of the tier's boxes and of tall boxes passing through it. */
  boxes: { id: Id; rect: PlanRect }[];
  /** Face frame members at this tier's height. */
  frame: PlanRect[];
  /** Door and drawer fronts at this tier's height. */
  fronts: PlanRect[];
  countertops: PlanRect[];
  /** Moldings at this tier's height (crown above the highest tier counts toward it). */
  trim: PlanRect[];
  /** Toe kick platforms: wall to kick face, under the cabinets. */
  kicks: PlanRect[];
  gaps: { spanId: Id; x: Ticks; width: Ticks }[];
  /** Deepest z of anything in the plan. */
  depth: Ticks;
}

const planRect = (p: Part): PlanRect => ({ x: p.bounds.x, z: p.bounds.z, width: p.bounds.width, depth: p.bounds.depth });

function dedupe(rects: readonly PlanRect[]): PlanRect[] {
  const seen = new Set<string>();
  return rects.filter((r) => {
    const k = `${r.x},${r.z},${r.width},${r.depth}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Merge rects of equal depth that touch end to end (e.g. a toe kick board pieced from several lengths). */
export function mergeRuns(rects: readonly PlanRect[]): PlanRect[] {
  const out: PlanRect[] = [];
  for (const r of [...rects].sort((a, b) => a.z - b.z || a.depth - b.depth || a.x - b.x)) {
    const prev = out[out.length - 1];
    if (prev && prev.z === r.z && prev.depth === r.depth && r.x <= prev.x + prev.width) {
      prev.width = Math.max(prev.width, r.x + r.width - prev.x);
    } else out.push({ ...r });
  }
  return out.sort((a, b) => a.x - b.x);
}

/** Footprints per box tier, bottom → top. Tiers with no boxes are left out. */
export function planTiers(result: RunResult): PlanTier[] {
  const out: PlanTier[] = [];
  const boxTiers = result.tiers.filter((t) => t.kind === 'boxes');
  const highest = boxTiers[boxTiers.length - 1];
  for (const t of boxTiers) {
    const y0 = t.y + t.toeKick;
    const y1 = t.y + t.height - t.countertop;
    const atHeight = (b: { y: Ticks; height: Ticks }) => b.y < y1 && y0 < b.y + b.height;
    const boxes = result.boxes
      .filter((b) => atHeight(b.carcass))
      .sort((a, b) => a.carcass.x - b.carcass.x)
      .map((b) => ({ id: b.id, rect: { x: b.carcass.x, z: b.carcass.z, width: b.carcass.width, depth: b.carcass.depth } }));
    if (boxes.length === 0) continue;
    const frame = dedupe(result.parts.filter((p) => isFrame(p.role) && atHeight(p.bounds)).map(planRect));
    // A five-piece front's panel sits inside its frame; its frame pieces give the footprint.
    const fronts = dedupe(result.parts.filter((p) => roleClass(p.role) === 'front' && atHeight(p.bounds)).map(planRect));
    const countertops = result.parts
      .filter((p) => p.role === 'countertop' && p.bounds.y >= t.y && p.bounds.y < t.y + t.height)
      .map(planRect);
    const top = t === highest ? Number.POSITIVE_INFINITY : t.y + t.height;
    const trim = dedupe(
      result.parts.filter((p) => roleClass(p.role) === 'trim' && p.bounds.y < top && t.y < p.bounds.y + p.bounds.height).map(planRect),
    );
    const kicks = mergeRuns(
      result.parts
        .filter((p) => isKickFront(p) && p.bounds.y < t.y + t.height && t.y < p.bounds.y + p.bounds.height)
        .map((p) => ({ x: p.bounds.x, z: 0, width: p.bounds.width, depth: p.bounds.z + p.bounds.depth })),
    );
    const gaps = result.gaps
      .filter((g) => g.rect.y < t.y + t.height && t.y < g.rect.y + g.rect.height)
      .map((g) => ({ spanId: g.spanId, x: g.rect.x, width: g.rect.width }));
    const depth = Math.max(t.depth, ...[...boxes.map((b) => b.rect), ...frame, ...fronts, ...countertops, ...trim].map((r) => r.z + r.depth));
    out.push({ tier: t, boxes, frame, fronts, countertops, trim, kicks, gaps, depth });
  }
  return out;
}

const overlapsX = (r: PlanRect, x0: Ticks, x1: Ticks) => r.x < x1 && x0 < r.x + r.width;
const front = (rs: readonly PlanRect[]) => (rs.length ? Math.max(...rs.map((r) => r.z + r.depth)) : undefined);

/** Depth profile of one box in plan: the z positions its depth chains measure. */
export interface DepthProfile {
  carcass: Ticks;
  frame?: Ticks;
  front?: Ticks;
  counter?: Ticks;
  kick?: Ticks;
  /** Extent of the box's footprint (with its frame and counter) across the page, for extension lines. */
  x0: Ticks;
  x1: Ticks;
}

export function depthProfile(plan: PlanTier, rect: PlanRect): DepthProfile {
  const x0 = rect.x;
  const x1 = rect.x + rect.width;
  const mid = (x0 + x1) / 2;
  const frame = plan.frame.filter((r) => overlapsX(r, x0, x1));
  const fronts = plan.fronts.filter((r) => overlapsX(r, x0, x1));
  const counter = plan.countertops.find((r) => r.x <= mid && mid <= r.x + r.width);
  const kick = plan.kicks.find((r) => r.x <= mid && mid <= r.x + r.width);
  const all = [rect, ...frame, ...fronts, ...(counter ? [counter] : [])];
  return {
    carcass: rect.z + rect.depth,
    frame: front(frame),
    front: front(fronts),
    counter: counter ? counter.z + counter.depth : undefined,
    kick: kick ? kick.depth : undefined,
    x0: Math.min(...all.map((r) => r.x)),
    x1: Math.max(...all.map((r) => r.x + r.width)),
  };
}

const sameProfile = (a: DepthProfile, b: DepthProfile) =>
  a.carcass === b.carcass && a.frame === b.frame && a.front === b.front && a.counter === b.counter && a.kick === b.kick;

const pts = (ats: readonly (Ticks | undefined)[], from: Ticks): ChainPoint[] =>
  ats.filter((a): a is Ticks => a !== undefined).map((at) => ({ at, from }));

/** Depth chains for one profile on one side: carcass/frame/front, then counter overhang, then toe kick setback. */
function profileChains(p: DepthProfile, side: 'left' | 'right'): Chain[] {
  const from = side === 'right' ? p.x1 : p.x0;
  const ff = p.frame ?? p.carcass;
  const chains: Chain[] = [{ side, row: 0, points: pts([0, p.carcass, p.frame, p.front], from) }];
  if (p.counter !== undefined) chains.push({ side, row: 1, points: pts([0, ff, p.counter], from) });
  if (p.kick !== undefined) chains.push({ side, row: 2, points: pts([p.kick, ff], from) });
  return chains;
}

/**
 * Chains for a tier's plan.
 *  - Below (room side): countertop lengths and end overhangs; then each contiguous group of
 *    boxes (frame included) between the walls, with the gaps between groups.
 *  - Right: depths of the rightmost box (carcass, frame, front; counter overhang; toe kick
 *    setback). Left: the same for the leftmost box, if it differs.
 */
export function planChains(result: RunResult, plan: PlanTier): Chain[] {
  const W = result.width;
  const chains: Chain[] = [];
  const footprint = [...plan.boxes.map((b) => b.rect), ...plan.frame, ...plan.fronts];
  let row = 0;
  if (plan.countertops.length) {
    const p: ChainPoint[] = [];
    for (const c of plan.countertops) {
      const from = c.z + c.depth;
      const under = footprint.filter((r) => overlapsX(r, c.x, c.x + c.width));
      p.push({ at: c.x, from }, { at: c.x + c.width, from });
      if (under.length) p.push({ at: Math.min(...under.map((r) => r.x)), from }, { at: Math.max(...under.map((r) => r.x + r.width)), from });
    }
    chains.push({ side: 'bottom', row: row++, points: p });
  }

  // Contiguous groups of boxes, each measured with its frame.
  const groups: { x0: Ticks; x1: Ticks }[] = [];
  for (const b of plan.boxes) {
    const g = groups[groups.length - 1];
    if (g && b.rect.x <= g.x1) g.x1 = Math.max(g.x1, b.rect.x + b.rect.width);
    else groups.push({ x0: b.rect.x, x1: b.rect.x + b.rect.width });
  }
  const gp: ChainPoint[] = [{ at: 0, from: plan.depth }, { at: W, from: plan.depth }];
  for (const g of groups) {
    const rs = footprint.filter((r) => overlapsX(r, g.x0, g.x1));
    const from = front(rs) ?? plan.depth;
    gp.push({ at: Math.min(g.x0, ...rs.map((r) => r.x)), from }, { at: Math.max(g.x1, ...rs.map((r) => r.x + r.width)), from });
  }
  chains.push({ side: 'bottom', row, points: gp });

  const first = plan.boxes[0];
  const last = plan.boxes[plan.boxes.length - 1];
  if (last) {
    const right = depthProfile(plan, last.rect);
    chains.push(...profileChains(right, 'right'));
    if (first && first !== last) {
      const left = depthProfile(plan, first.rect);
      if (!sameProfile(left, right)) chains.push(...profileChains(left, 'left'));
    }
  }
  return compactChains(chains);
}
