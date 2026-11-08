import type { Ticks } from '../units';
import type { Ctx } from './context';
import type { PlacedBox } from './layout';

/**
 * How far a box's finished end reaches past its carcass side at an open edge: a full-width end
 * stile (and the end panel behind it) overhangs the side by side thickness + lip. Layout reserves
 * that space, so countertops and toe kicks extend by it to stay flush with the finished end.
 */
export function endReach(ctx: Ctx, box: PlacedBox, side: 'left' | 'right'): Ticks {
  const s = box.settings;
  if (s.construction === 'frameless') return 0;
  return s.faceFrame.endStiles[side] === 'full' ? ctx.thickness(s.materials.carcass, box.id) + s.faceFrame.lip : 0;
}
