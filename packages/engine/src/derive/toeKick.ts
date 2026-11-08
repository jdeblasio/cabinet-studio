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
import { inches, type Ticks } from '../units';
import { makePart, type Ctx } from './context';
import type { PlacedBox, RunLayoutResult } from './layout';
import { endReach } from './reach';

export function deriveToeKick(ctx: Ctx, layout: RunLayoutResult): Part[] {
  const kick = layout.toeKick;
  if (!kick) return [];
  const s = kick.settings;
  const tk = ctx.thickness(s.materials.toeKick, kick.tierId);
  const tf = s.construction === 'frameless' ? 0 : ctx.thickness(s.materials.faceFrame, kick.tierId);
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
    const cross = platformDepth - 2 * tk;
    // Miter the kick around open ends: a full-depth return instead of the end cross piece.
    const mitre = !!ctx.run.tiers.find((t) => t.id === kick.tierId)?.toeKick?.mitreOpenEnds;
    const mitreL = mitre && !first.atLeftWall;
    const mitreR = mitre && !lastBox.atRightWall;
    // A single-sided island's finished back panel runs to the floor: the returns run back over its ends.
    const backPanel = ctx.run.kind === 'island' && !ctx.run.islandOf && ctx.run.island?.back === 'panel' ? ctx.thickness(s.materials.carcass, kick.tierId) : 0;
    const common = { role: 'toeKick' as const, materialId: s.materials.toeKick, ownerId: kick.tierId };
    // Cross pieces at both ends and under every joint between boxes.
    const xs = [xa, ...seg.slice(1).map((b) => b.carcass.x - tk / 2), xb - tk];
    // Boards longer than the material's sheet are pieced, joined over a cross piece.
    const centers = xs.map((cx) => cx + tk / 2);
    const boards = (which: 'front' | 'back', a: Ticks, b: Ticks, z: Ticks, name: string) => {
      const pieces = splitAt(a, b, centers, maxBoard(ctx, s.materials.toeKick));
      pieces.forEach(([p0, p1], k) => {
        parts.push(
          makePart({
            ...common,
            id: pieces.length === 1 ? `${base}-${which}` : `${base}-${which}-${k}`,
            name,
            bounds: { x: p0, y: 0, z, width: p1 - p0, height: h, depth: tk },
            grain: 'horizontal',
            thicknessAxis: 'z',
            length: ctx.down(p1 - p0),
            ...(pieces.length > 1 ? { note: `Piece ${k + 1} of ${pieces.length}; joints fall on cross pieces` } : {}),
          }),
        );
      });
    };
    const frontStart = parts.length;
    boards('front', fa, fb, platformDepth - tk, 'Toe kick (front)');
    // The front board's mitered ends (its first and last piece).
    const fronts = parts.slice(frontStart);
    const mark = (p: Part | undefined, face: 'left' | 'right') => {
      if (!p) return;
      const i = parts.indexOf(p);
      parts[i] = { ...p, mitres: [...(p.mitres ?? []), { face, outer: 'front' }], note: [p.note, `45° miter at the ${face} end, with the return`].filter(Boolean).join('; ') };
    };
    if (mitreL) mark(fronts[0], 'left');
    if (mitreR) mark(parts[frontStart + fronts.length - 1], 'right');
    // The back board stops against a return.
    boards('back', xa + (mitreL ? tk : 0), xb - (mitreR ? tk : 0), 0, 'Toe kick (back)');
    xs.forEach((cx, ci) => {
      const isReturn = (ci === 0 && mitreL) || (ci === xs.length - 1 && mitreR);
      if (isReturn) {
        // Full depth, from the wall to the front face, mitered with the front board at the corner.
        parts.push(
          makePart({ ...common, id: `${base}-return-${ci === 0 ? 'left' : 'right'}`, name: 'Toe kick (return)', bounds: { x: cx, y: 0, z: backPanel ? -backPanel : 0, width: tk, height: h, depth: platformDepth + backPanel }, grain: 'horizontal', thicknessAxis: 'x', length: ctx.down(platformDepth + backPanel), width: h, note: '45° miter at the front end, with the front board' }),
        );
        parts[parts.length - 1] = { ...parts[parts.length - 1]!, mitres: [{ face: 'front', outer: ci === 0 ? 'left' : 'right' }] };
        return;
      }
      parts.push(
        makePart({ ...common, id: `${base}-cross-${ci}`, name: 'Toe kick (cross)', bounds: { x: cx, y: 0, z: tk, width: tk, height: h, depth: cross }, grain: 'horizontal', thicknessAxis: 'x', length: ctx.down(cross), width: h }),
      );
    });
  });
  return parts;
}

/** Longest board that fits the material's sheet (less a little for trimming), or no limit for lumber. */
function maxBoard(ctx: Ctx, materialId: string): Ticks {
  const m = ctx.project.materials.find((mm) => mm.id === materialId);
  return m?.kind === 'sheet' && m.sheet ? m.sheet.length - inches(1 / 2) : Infinity;
}

/**
 * Split [a, b] into pieces no longer than `max`, cutting at the given joint positions where
 * possible (the farthest one that keeps a piece within `max`), else at `max`.
 */
export function splitAt(a: Ticks, b: Ticks, joints: readonly Ticks[], max: Ticks): [Ticks, Ticks][] {
  const pieces: [Ticks, Ticks][] = [];
  let start = a;
  while (b - start > max) {
    const options = joints.filter((j) => j > start && j - start <= max && j < b);
    const cut = options.length ? Math.max(...options) : start + max;
    pieces.push([start, cut]);
    start = cut;
  }
  pieces.push([start, b]);
  return pieces;
}
