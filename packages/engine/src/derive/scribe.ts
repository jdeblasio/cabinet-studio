/**
 * Scribe strips. At a wall, a box sits `scribeAllowance` off the wall and its end stile spans that
 * space, scribed to the wall. Usually something closes the space from below (the box underneath
 * at the same wall, or the floor). Over a doorway or other opening that runs up to the wall,
 * nothing does: from below, the stile seems to overhang the box and the slot behind it shows.
 * A strip of face-frame stock fills the space at the bottom, flush with the box bottom.
 */
import type { Part } from '../derived';
import { makePart, type Ctx } from './context';
import type { PlacedBox, RunLayoutResult } from './layout';

export function deriveScribeStrips(ctx: Ctx, layout: RunLayoutResult): Part[] {
  const parts: Part[] = [];
  const counter = new Map(layout.tiers.map((t) => [t.tierId, t.countertop]));
  // Top surface a box presents to the box above: its carcass top, or its tier's countertop.
  const topOf = (o: PlacedBox) => o.carcass.y + o.carcass.height + (o.source === 'tier' ? (counter.get(o.tierId) ?? 0) : 0);
  const floor = layout.toeKick?.height ?? 0;

  for (const b of layout.boxes) {
    if (b.carcass.y <= floor) continue; // on the floor or the toe kick
    for (const side of ['left', 'right'] as const) {
      const atWall = side === 'left' ? b.atLeftWall : b.atRightWall;
      if (!atWall) continue;
      const x0 = side === 'left' ? 0 : b.carcass.x + b.carcass.width;
      const x1 = side === 'left' ? b.carcass.x : layout.width;
      if (x1 <= x0) continue;
      // A box below at the same wall continues the (enclosed) scribe space down to the floor.
      const closedBelow = layout.boxes.some((o) => o !== b && (side === 'left' ? o.atLeftWall : o.atRightWall) && topOf(o) === b.carcass.y);
      if (closedBelow) continue;
      const s = b.settings;
      const tf = ctx.thickness(s.materials.faceFrame, b.id);
      const depth = b.carcass.depth;
      parts.push(
        makePart({
          id: `${b.id}/scribe-strip-${side}`,
          name: 'Scribe strip',
          role: 'filler',
          materialId: s.materials.faceFrame,
          bounds: { x: x0, y: b.carcass.y, z: b.carcass.z, width: x1 - x0, height: tf, depth },
          grain: 'horizontal',
          thicknessAxis: 'y',
          ownerId: b.id,
          // Runs front to back; ripped to the scribe width (scribe it to the wall on site).
          length: depth,
          width: x1 - x0,
        }),
      );
    }
  }
  return parts;
}
