/**
 * Countertops: one slab per contiguous run of boxes in a tier that has a countertop. It sits on
 * the carcasses (inside the tier band), runs back to the wall and forward past the face of the
 * face frame by `frontOverhang`. At each end it runs to the wall, overhangs an open end or a gap
 * by `endOverhang` (measured from the end stile's outer edge), or stops at any other box.
 */
import type { Part } from '../derived';
import { resolveSettings } from '../settings';
import type { Ticks } from '../units';
import { makePart, type Ctx } from './context';
import type { PlacedBox, RunLayoutResult } from './layout';

export function deriveCountertops(ctx: Ctx, layout: RunLayoutResult, stiles: readonly Part[]): Part[] {
  const parts: Part[] = [];
  for (const tl of layout.tiers) {
    const tier = ctx.run.tiers.find((t) => t.id === tl.tierId);
    const ct = tier?.countertop;
    if (!tier || !ct || tl.countertop <= 0) continue;
    const settings = resolveSettings(ctx.project, [ctx.run, tier]);
    ctx.thickness(settings.materials.countertop, tier.id); // reports a missing material
    const y0 = tl.y + tl.height - tl.countertop;
    const y1 = tl.y + tl.height;

    const own = layout.boxes.filter((b) => b.source === 'tier' && b.tierId === tier.id).sort((a, b) => a.carcass.x - b.carcass.x);
    // Other carcasses at countertop height (e.g. a tall box beside the counter) stop it.
    const blocks = layout.boxes.filter((b) => !own.includes(b) && b.carcass.y < y1 && b.carcass.y + b.carcass.height > y0);

    const segments: PlacedBox[][] = [];
    for (const b of own) {
      const seg = segments[segments.length - 1];
      const prev = seg?.[seg.length - 1];
      if (seg && prev && prev.carcass.x + prev.carcass.width === b.carcass.x) seg.push(b);
      else segments.push([b]);
    }

    segments.forEach((seg, si) => {
      const first = seg[0]!;
      const last = seg[seg.length - 1]!;
      const left = first.carcass.x;
      const right = last.carcass.x + last.carcass.width;
      /** How far the end box's frame reaches past its side (a full-width end stile overhangs it). */
      const stileReach = (b: PlacedBox, side: 'left' | 'right'): Ticks =>
        b.settings.faceFrame.endStiles[side] === 'full' ? ctx.thickness(b.settings.materials.carcass, b.id) + b.settings.faceFrame.lip : 0;

      let xa = first.atLeftWall ? 0 : left - stileReach(first, 'left') - ct.endOverhang;
      let xb = last.atRightWall ? layout.width : right + stileReach(last, 'right') + ct.endOverhang;
      for (const o of blocks) {
        const ox0 = o.carcass.x;
        const ox1 = ox0 + o.carcass.width;
        if (ox1 <= left && ox1 > xa) xa = ox1;
        if (ox0 >= right && ox0 < xb) xb = ox0;
      }

      const tf = ctx.thickness(settings.materials.faceFrame, tier.id);
      const depth = first.carcass.depth + tf + ct.frontOverhang;
      const part = makePart({
        id: `${tier.id}/countertop-${si}`,
        name: 'Countertop',
        role: 'countertop',
        materialId: settings.materials.countertop,
        bounds: { x: xa, y: y0, z: first.carcass.z, width: xb - xa, height: tl.countertop, depth },
        grain: 'horizontal',
        thicknessAxis: 'y',
        ownerId: tier.id,
      });
      parts.push(part);

      // A stile that runs up past the counter (e.g. shared with a tall box) needs a notch.
      const b = part.bounds;
      for (const st of stiles) {
        const sb = st.bounds;
        const overlaps =
          sb.x < b.x + b.width && b.x < sb.x + sb.width && sb.y < b.y + b.height && b.y < sb.y + sb.height && sb.z < b.z + b.depth && b.z < sb.z + sb.depth;
        if (overlaps) {
          ctx.issue('info', 'countertop-notch', tier.id, `Notch the countertop around the face frame stile ${ctx.fmt(sb.x)} from the left wall.`);
        }
      }
    });
  }
  return parts;
}
