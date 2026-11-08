/**
 * Toe kick: a separate base platform (ladder frame) under the bottom tier's carcasses.
 * One platform per contiguous, same-depth run of boxes. The kick board's face is set back
 * `setback` from the face of the face frame.
 *
 * Ends stay flush with the finished cabinet: at an open end with a full-width end stile, the
 * platform runs under the end panel to its outer face; at a wall, the front kick board runs to
 * the wall (scribed) so no slot shows beside the scribe stile.
 */
import type { Part } from '../derived';
import { makePart, type Ctx } from './context';
import type { PlacedBox, RunLayoutResult } from './layout';
import { endReach } from './reach';

export function deriveToeKick(ctx: Ctx, layout: RunLayoutResult): Part[] {
  const kick = layout.toeKick;
  if (!kick) return [];
  const s = kick.settings;
  const tk = ctx.thickness(s.materials.toeKick, kick.tierId);
  const tf = ctx.thickness(s.materials.faceFrame, kick.tierId);
  const floorBoxes = layout.boxes
    .filter((b) => b.carcass.y === kick.height)
    .sort((a, b) => a.carcass.x - b.carcass.x);

  // Contiguous, same-depth segments.
  const segments: PlacedBox[][] = [];
  for (const b of floorBoxes) {
    const seg = segments[segments.length - 1];
    const prev = seg?.[seg.length - 1];
    if (seg && prev && prev.carcass.x + prev.carcass.width === b.carcass.x && prev.carcass.depth === b.carcass.depth) seg.push(b);
    else segments.push([b]);
  }

  const parts: Part[] = [];
  const h = kick.height;
  segments.forEach((seg, si) => {
    const first = seg[0]!;
    const lastBox = seg[seg.length - 1]!;
    const xa = first.carcass.x - (first.atLeftWall ? 0 : endReach(ctx, first, 'left'));
    const xb = lastBox.carcass.x + lastBox.carcass.width + (lastBox.atRightWall ? 0 : endReach(ctx, lastBox, 'right'));
    // The front kick board runs on to a wall.
    const fa = first.atLeftWall ? 0 : xa;
    const fb = lastBox.atRightWall ? layout.width : xb;
    const D = first.carcass.depth;
    const platformDepth = D + tf - kick.setback;
    if (platformDepth < 3 * tk) {
      ctx.issue('error', 'toe-kick-setback', kick.tierId, 'Toe kick setback is deeper than the cabinets.');
      return;
    }
    const base = `${kick.tierId}/kick-${si}`;
    const len = xb - xa;
    const cross = platformDepth - 2 * tk;
    const common = { role: 'toeKick' as const, materialId: s.materials.toeKick, ownerId: kick.tierId };
    parts.push(
      makePart({ ...common, id: `${base}-front`, name: 'Toe kick (front)', bounds: { x: fa, y: 0, z: platformDepth - tk, width: fb - fa, height: h, depth: tk }, grain: 'horizontal', thicknessAxis: 'z', length: ctx.down(fb - fa) }),
      makePart({ ...common, id: `${base}-back`, name: 'Toe kick (back)', bounds: { x: xa, y: 0, z: 0, width: len, height: h, depth: tk }, grain: 'horizontal', thicknessAxis: 'z', length: ctx.down(len) }),
    );
    // Cross pieces at both ends and under every joint between boxes.
    const xs = [xa, ...seg.slice(1).map((b) => b.carcass.x - tk / 2), xb - tk];
    xs.forEach((cx, ci) => {
      parts.push(
        makePart({ ...common, id: `${base}-cross-${ci}`, name: 'Toe kick (cross)', bounds: { x: cx, y: 0, z: tk, width: tk, height: h, depth: cross }, grain: 'horizontal', thicknessAxis: 'x', length: ctx.down(cross) }),
      );
    });
  });
  return parts;
}
