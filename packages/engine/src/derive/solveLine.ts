import type { SizeSpec } from '../model';
import { snap, type Ticks } from '../units';

export interface LineSolution {
  /** Resolved size of each item, snapped to the grid (fixed sizes to nearest, flex sizes down). */
  sizes: Ticks[];
  /** Unused space after snapping/clamping (≥ 0). The caller decides where it goes. */
  remainder: Ticks;
  /** How much the resolved sizes exceed `available` (≥ 0), e.g. fixed sizes + flex minimums too large. */
  overflow: Ticks;
}

type FlexSpec = Extract<SizeSpec, { kind: 'flex' }>;

/**
 * Distribute `available` among items, CSS flex-like:
 * fixed items take their size; flex items share what's left in proportion to `ratio`,
 * clamped to [min, max] (violators are frozen and the rest re-distributed).
 *
 * Flex sizes are snapped *down* to the grid so that flex items with equal ratios come out
 * identical (identical parts in the cut list); the leftover is reported as `remainder`.
 */
export function solveLine(available: Ticks, items: readonly SizeSpec[], grid: Ticks): LineSolution {
  const sizes: Ticks[] = items.map(() => 0);
  let fixedSum = 0;
  const flexIdx: number[] = [];
  items.forEach((it, i) => {
    if (it.kind === 'fixed') {
      const s = Math.max(0, snap(it.size, grid));
      sizes[i] = s;
      fixedSum += s;
    } else {
      flexIdx.push(i);
    }
  });

  if (flexIdx.length > 0) {
    const specs = flexIdx.map((i) => items[i] as FlexSpec);
    const raw = distributeFlex(available - fixedSum, specs);
    flexIdx.forEach((i, k) => {
      const spec = specs[k]!;
      const minS = spec.min !== undefined ? snap(spec.min, grid, 'up') : 0;
      let s = Math.max(minS, snap(raw[k]!, grid, 'down'));
      if (spec.max !== undefined) s = Math.max(minS, Math.min(s, snap(spec.max, grid, 'down')));
      sizes[i] = Math.max(0, s);
    });
  }

  const used = sizes.reduce((a, b) => a + b, 0);
  return { sizes, remainder: Math.max(0, available - used), overflow: Math.max(0, used - available) };
}

function distributeFlex(free: number, specs: readonly FlexSpec[]): number[] {
  const n = specs.length;
  const out = specs.map(() => 0);
  const frozen = specs.map(() => false);
  for (let iter = 0; iter <= n; iter++) {
    let remaining = free;
    let totalRatio = 0;
    specs.forEach((sp, k) => {
      if (frozen[k]) remaining -= out[k]!;
      else totalRatio += Math.max(0, sp.ratio);
    });
    let violation = 0;
    const kind: (0 | 1 | -1)[] = specs.map(() => 0); // 1 = hit min, -1 = hit max
    specs.forEach((sp, k) => {
      if (frozen[k]) return;
      const base = totalRatio > 0 ? (remaining * Math.max(0, sp.ratio)) / totalRatio : 0;
      const lo = sp.min ?? 0;
      const hi = sp.max ?? Number.POSITIVE_INFINITY;
      const c = Math.min(Math.max(base, lo), Math.max(lo, hi));
      out[k] = c;
      violation += c - base;
      kind[k] = c > base ? 1 : c < base ? -1 : 0;
    });
    if (Math.abs(violation) < 1e-6) break;
    const freezeKind = violation > 0 ? 1 : -1;
    let any = false;
    specs.forEach((_, k) => {
      if (!frozen[k] && kind[k] === freezeKind) {
        frozen[k] = true;
        any = true;
      }
    });
    if (!any || frozen.every(Boolean)) break;
  }
  return out;
}
