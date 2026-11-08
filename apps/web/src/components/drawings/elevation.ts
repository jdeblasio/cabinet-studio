/**
 * Front elevation geometry for drawings: dimension chains for a run and for a single box, and
 * the door and drawer-front leaves (for hinge-side swing marks).
 * World axes: u = x along the run, v = y up.
 */
import type { BoxLayout, Id, Part, Rect, RunResult, Ticks } from '@built-in-planner/engine';
import { compactChains, type Chain, type ChainPoint } from './dimensions';
import { isFront, isFrame, roleClass } from './parts';

const pts = (ats: readonly Ticks[], from: Ticks): ChainPoint[] => ats.map((at) => ({ at, from }));

/**
 * Chains for a run's front elevation.
 *  - Top: box (and slot) widths of each box tier above the lowest, highest tier nearest; then the
 *    overall width.
 *  - Bottom: box widths of the lowest box tier.
 *  - Left: tier heights and the ceiling gap; then the overall height of the built-in.
 *  - Right: toe kick / carcass / countertop per tier (when any tier has a kick or counter); then
 *    the ceiling height.
 */
export function elevationChains(result: RunResult): Chain[] {
  const W = result.width;
  const H = result.ceilingHeight;
  const chains: Chain[] = [];
  const boxTiers = result.tiers.filter((t) => t.kind === 'boxes' && t.items.length > 0);
  const itemEdges = (t: (typeof boxTiers)[number]) => [0, W, ...t.items.flatMap((it) => [it.x, it.x + it.width])];

  const [lowest, ...higher] = boxTiers;
  higher.reverse().forEach((t, i) => chains.push({ side: 'top', row: i, points: pts(itemEdges(t), t.y + t.height) }));
  chains.push({ side: 'top', row: higher.length, points: pts([0, W], H) });
  if (lowest) chains.push({ side: 'bottom', row: 0, points: pts(itemEdges(lowest), lowest.y) });

  if (result.tiers.length > 0) {
    const top = Math.max(...result.tiers.map((t) => t.y + t.height));
    chains.push({ side: 'left', row: 0, points: pts([0, H, ...result.tiers.flatMap((t) => [t.y, t.y + t.height])], 0) });
    chains.push({ side: 'left', row: 1, points: pts([0, top], 0) });
    const detail = result.tiers.some((t) => t.toeKick > 0 || t.countertop > 0);
    if (detail) {
      const ys = result.tiers.flatMap((t) => [t.y, t.y + t.toeKick, t.y + t.height - t.countertop, t.y + t.height]);
      chains.push({ side: 'right', row: 0, points: pts([0, H, ...ys], W) });
    }
    chains.push({ side: 'right', row: detail ? 1 : 0, points: pts([0, H], W) });
  }
  return compactChains(chains);
}

/**
 * Chains for one box's front view: frame members and openings across the top (then the
 * overall width), and up the left side (then the overall height). Carcass edges are the ends.
 */
export function boxChains(box: BoxLayout): Chain[] {
  const c = box.carcass;
  const x0 = c.x;
  const x1 = c.x + c.width;
  const y0 = c.y;
  const y1 = c.y + c.height;
  const openings = box.sections.filter((s) => s.kind === 'opening');
  const xs = [x0, x1, ...openings.flatMap((o) => [o.rect.x, o.rect.x + o.rect.width])].filter((x) => x >= x0 && x <= x1);
  const ys = [y0, y1, ...openings.flatMap((o) => [o.rect.y, o.rect.y + o.rect.height])].filter((y) => y >= y0 && y <= y1);
  return compactChains([
    { side: 'top', row: 0, points: pts(xs, y1) },
    { side: 'top', row: 1, points: pts([x0, x1], y1) },
    { side: 'left', row: 0, points: pts(ys, x0) },
    { side: 'left', row: 1, points: pts([y0, y1], x0) },
  ]);
}

/** A door or drawer front as seen in elevation (all its pieces, for five-piece fronts). */
export interface FrontLeaf {
  rect: Rect;
  kind: 'door' | 'drawer';
  /** Doors: the hinged edge. */
  hinge?: 'left' | 'right';
  sectionId: Id;
}

function bbox(parts: readonly Part[]): Rect {
  const x0 = Math.min(...parts.map((p) => p.bounds.x));
  const y0 = Math.min(...parts.map((p) => p.bounds.y));
  const x1 = Math.max(...parts.map((p) => p.bounds.x + p.bounds.width));
  const y1 = Math.max(...parts.map((p) => p.bounds.y + p.bounds.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Front leaves of each opening (optionally of one box), from the front parts whose ids are under
 * the opening's id. A door pair splits at the opening's center: left leaf hinged left, right
 * leaf hinged right.
 */
export function frontLeaves(result: RunResult, boxId?: Id): FrontLeaf[] {
  const out: FrontLeaf[] = [];
  const fronts = result.parts.filter((p) => isFront(p.role));
  for (const box of result.boxes) {
    if (boxId !== undefined && box.id !== boxId) continue;
    for (const sec of box.sections) {
      const front = sec.front;
      if (sec.kind !== 'opening' || !front || front.type === 'none') continue;
      const prefix = `${sec.sectionId}/`;
      const ps = fronts.filter((p) => p.id.startsWith(prefix));
      if (ps.length === 0) continue;
      if (front.type === 'doorPair') {
        const mid = sec.rect.x + sec.rect.width / 2;
        const left = ps.filter((p) => p.bounds.x + p.bounds.width / 2 < mid);
        const right = ps.filter((p) => p.bounds.x + p.bounds.width / 2 >= mid);
        if (left.length) out.push({ rect: bbox(left), kind: 'door', hinge: 'left', sectionId: sec.sectionId });
        if (right.length) out.push({ rect: bbox(right), kind: 'door', hinge: 'right', sectionId: sec.sectionId });
      } else if (front.type === 'door') {
        out.push({ rect: bbox(ps), kind: 'door', hinge: front.hinge, sectionId: sec.sectionId });
      } else {
        out.push({ rect: bbox(ps), kind: 'drawer', sectionId: sec.sectionId });
      }
    }
  }
  return out;
}

/**
 * What a box's front view shows: the parts it owns (no countertop or toe kick, which belong to
 * the tier) plus any face frame member over its carcass owned by a neighbor (shared stiles).
 * The window spans those parts across, and the carcass height up.
 */
export function boxView(result: RunResult, box: BoxLayout): { parts: Part[]; u0: Ticks; u1: Ticks; v0: Ticks; v1: Ticks } {
  const c = box.carcass;
  const x0 = c.x;
  const x1 = c.x + c.width;
  const y0 = c.y;
  const y1 = c.y + c.height;
  const over = (p: Part) => p.bounds.x < x1 && x0 < p.bounds.x + p.bounds.width && p.bounds.y < y1 && y0 < p.bounds.y + p.bounds.height;
  const parts = result.parts.filter((p) => {
    const cls = roleClass(p.role);
    if (cls === 'countertop' || cls === 'kick') return false;
    return p.ownerId === box.id ? over(p) : isFrame(p.role) && over(p);
  });
  const u0 = Math.min(x0, ...parts.map((p) => p.bounds.x));
  const u1 = Math.max(x1, ...parts.map((p) => p.bounds.x + p.bounds.width));
  return { parts, u0, u1, v0: y0, v1: y1 };
}
