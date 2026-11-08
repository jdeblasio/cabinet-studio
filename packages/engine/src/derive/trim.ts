/**
 * Moldings, as simplified bounding-box profiles (DESIGN: "moldings as simplified profiles").
 *
 * Crown runs along the front of the top tier's boxes, its top against the ceiling (or sitting on
 * the boxes when the ceiling gap is taller than the crown). Base molding runs along the front of
 * the bottom tier at the floor; over a toe kick it covers the kick board (flush with the frame
 * when the kick's setback is 0), so the platform still levels the boxes. It should stay below the
 * lowest fronts (or the bottom of open boxes). Each contiguous, same-depth stretch
 * of boxes gets one front piece. At a wall it runs to the wall; at an open end the front piece
 * extends by the projection (outside miter) and a return runs back along the side to the wall.
 */
import type { Mitre, Part } from '../derived';
import type { Molding } from '../model';
import type { Ticks } from '../units';
import { makePart, type Ctx } from './context';
import type { PlacedBox, RunLayoutResult } from './layout';
import { endReach } from './reach';

export function deriveTrim(ctx: Ctx, layout: RunLayoutResult, boxParts: readonly Part[] = []): Part[] {
  const trim = ctx.run.trim;
  if (!trim) return [];
  const parts: Part[] = [];
  const tiers = ctx.run.tiers;

  if (trim.crown) {
    const top = tiers[tiers.length - 1];
    const tl = layout.tiers[layout.tiers.length - 1];
    if (!top || !tl || top.kind !== 'boxes') {
      ctx.issue('info', 'crown-ignored', ctx.run.id, 'Crown molding needs boxes in the top tier.');
    } else {
      const tierTop = tl.y + tl.height;
      const boxes = layout.boxes.filter((b) => b.carcass.y + b.carcass.height === tierTop);
      const crownTop = Math.min(layout.ceilingHeight, tierTop + trim.crown.height);
      if (tierTop + trim.crown.height < layout.ceilingHeight) {
        ctx.issue('info', 'crown-short', ctx.run.id, `The crown is shorter than the ${ctx.fmt(layout.ceilingHeight - tierTop)} gap above the boxes; it sits on top of them.`);
      }
      runMolding(ctx, layout, boxes, trim.crown, crownTop - trim.crown.height, 'crown', 'Crown', parts);
    }
  }

  if (trim.base) {
    const kick = layout.toeKick;
    // The bottom tier's boxes: on the floor, or on the toe kick platform.
    const boxes = layout.boxes.filter((b) => b.carcass.y === (kick ? kick.height : 0));
    if (kick && kick.setback > 0) {
      ctx.issue(
        'info',
        'base-molding-recess',
        ctx.run.id,
        `The toe kick is set back ${ctx.fmt(kick.setback)}, so the base molding bridges the recess with nothing behind its lower ${ctx.fmt(kick.height)}. Set the kick's setback to 0 so the molding sits on the kick board.`,
      );
    }
    const limit = lowestFace(boxes, boxParts);
    if (limit && trim.base.height > limit.y) {
      ctx.issue(
        'warning',
        'base-molding-tall',
        ctx.run.id,
        `The base molding is ${ctx.fmt(trim.base.height)} tall, but the ${limit.what} start ${ctx.fmt(limit.y)} above the floor: it would cover ${limit.what === 'openings' ? 'their bottoms' : 'them'}. Use a shorter molding, or a taller toe kick or bottom rail.`,
      );
    }
    runMolding(ctx, layout, boxes, trim.base, 0, 'base', 'Base molding', parts);
  }
  return parts;
}

/**
 * How high a base molding can go: the bottom of the lowest door or drawer front, or of the lowest
 * opening (the top of the bottom rail, or of the bottom panel when frameless) for open boxes.
 */
function lowestFace(boxes: readonly PlacedBox[], parts: readonly Part[]): { y: Ticks; what: 'fronts' | 'openings' } | null {
  let best: { y: Ticks; what: 'fronts' | 'openings' } | null = null;
  const consider = (y: Ticks, what: 'fronts' | 'openings') => {
    if (!best || y < best.y) best = { y, what };
  };
  for (const b of boxes) {
    const own = parts.filter((p) => p.ownerId === b.id);
    const fronts = own.filter((p) => p.role === 'door' || p.role === 'drawerFront' || p.role === 'frontFrame');
    if (fronts.length) consider(Math.min(...fronts.map((p) => p.bounds.y)), 'fronts');
    const floor = own.find((p) => p.id === `${b.id}/rail-bottom`) ?? own.find((p) => p.id === `${b.id}/bottom`);
    if (floor) consider(floor.bounds.y + floor.bounds.height, fronts.length ? 'fronts' : 'openings');
  }
  return best;
}

/** One molding along the fronts of `boxes` (grouped into contiguous, same-depth stretches). */
function runMolding(ctx: Ctx, layout: RunLayoutResult, boxes: readonly PlacedBox[], m: Molding, y: Ticks, key: string, name: string, out: Part[]): void {
  const sorted = [...boxes].sort((a, b) => a.carcass.x - b.carcass.x);
  const segments: PlacedBox[][] = [];
  for (const b of sorted) {
    const seg = segments[segments.length - 1];
    const prev = seg?.[seg.length - 1];
    if (seg && prev && prev.carcass.x + prev.carcass.width === b.carcass.x && prev.carcass.depth === b.carcass.depth) seg.push(b);
    else segments.push([b]);
  }
  segments.forEach((seg, si) => {
    const first = seg[0]!;
    const last = seg[seg.length - 1]!;
    const s = first.settings;
    const tf = s.construction === 'frameless' ? 0 : ctx.thickness(s.materials.faceFrame, first.id);
    const face = first.carcass.z + first.carcass.depth + tf;
    const material = s.materials.molding;
    const leftOpen = !first.atLeftWall;
    const rightOpen = !last.atRightWall;
    // Outer edges of the finished cabinets (a full-width end stile reaches past the side).
    const xa = leftOpen ? first.carcass.x - endReach(ctx, first, 'left') : 0;
    const xb = rightOpen ? last.carcass.x + last.carcass.width + endReach(ctx, last, 'right') : layout.width;
    const x0 = leftOpen ? xa - m.projection : xa;
    const x1 = rightOpen ? xb + m.projection : xb;
    const base = `${ctx.run.id}/${key}-${si}`;
    const common = { role: 'molding' as const, materialId: material, ownerId: ctx.run.id };
    // At open ends the front piece and its return meet in a 45° miter at the outside corner.
    const frontMitres: Mitre[] = [...(leftOpen ? [{ face: 'left' as const, outer: 'front' as const }] : []), ...(rightOpen ? [{ face: 'right' as const, outer: 'front' as const }] : [])];
    out.push({
      ...makePart({ ...common, id: `${base}-front`, name, bounds: { x: x0, y, z: face, width: x1 - x0, height: m.height, depth: m.projection }, grain: 'horizontal', thicknessAxis: 'z', note: 'Molding: buy by length; miter at open ends' }),
      ...(frontMitres.length ? { mitres: frontMitres } : {}),
    });
    const depth = face + m.projection - first.carcass.z;
    const ret = (side: 'left' | 'right', x: Ticks) =>
      out.push({
        ...makePart({ ...common, id: `${base}-return-${side}`, name: `${name} return`, bounds: { x, y, z: first.carcass.z, width: m.projection, height: m.height, depth }, grain: 'horizontal', thicknessAxis: 'x', length: depth, width: m.height, note: 'Return along the side to the wall; miter at the front' }),
        mitres: [{ face: 'front', outer: side }],
      });
    if (leftOpen) ret('left', x0);
    if (rightOpen) ret('right', xb);
  });
}
