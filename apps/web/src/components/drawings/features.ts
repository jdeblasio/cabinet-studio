/**
 * Machining features (drilled holes) for box sheets: shelf pin rows seen on the side panels in
 * section, hinge cups seen (hidden) on doors in the front view, their dimension chains, and a
 * per-label summary for notes.
 */
import type { Part, PartFeature, Ticks } from '@built-in-planner/engine';
import type { Chain } from './dimensions';

export const holesOf = (p: Part): PartFeature[] => (p.features ?? []).filter((f) => f.kind === 'hole');

const uniq = (xs: readonly Ticks[]): Ticks[] => [...new Set(xs)].sort((a, b) => a - b);

export interface HoleSummary {
  label: string;
  count: number;
  /** Parts drilled. */
  parts: number;
  diameter: Ticks;
  depth: Ticks;
  /** Spacing along evenly spaced rows of three or more holes. */
  pitch?: Ticks;
}

/** Holes across parts, by label (e.g. "Shelf pin", "Hinge cup"). */
export function holeSummary(parts: readonly Part[]): HoleSummary[] {
  const by = new Map<string, { holes: PartFeature[]; parts: Set<string>; pitch?: Ticks }>();
  for (const p of parts) {
    for (const h of holesOf(p)) {
      const e = by.get(h.label) ?? { holes: [], parts: new Set<string>() };
      e.holes.push(h);
      e.parts.add(p.id);
      by.set(h.label, e);
    }
    // Rows run up the part: holes sharing every coordinate but y.
    const rows = new Map<string, PartFeature[]>();
    for (const h of holesOf(p)) {
      const key = `${h.label}|${h.axis}|${h.x}|${h.z}`;
      rows.set(key, [...(rows.get(key) ?? []), h]);
    }
    for (const row of rows.values()) {
      if (row.length < 3) continue;
      const ys = uniq(row.map((h) => h.y));
      const steps = ys.slice(1).map((y, i) => y - ys[i]!);
      const e = by.get(row[0]!.label)!;
      if (steps.length && steps.every((d) => d === steps[0])) e.pitch ??= steps[0];
    }
  }
  return [...by.entries()].map(([label, e]) => ({
    label,
    count: e.holes.length,
    parts: e.parts.size,
    diameter: e.holes[0]!.diameter,
    depth: e.holes[0]!.depth,
    ...(e.pitch !== undefined ? { pitch: e.pitch } : {}),
  }));
}

/**
 * Chains for the shelf pin rows on a side or partition, in a section view (u = z, v = y):
 * on the left, panel bottom → first hole → last hole → panel top; above, the rows' setbacks
 * across the panel's depth.
 */
export function pinRowChains(part: Part): Chain[] {
  const hs = holesOf(part).filter((h) => h.axis === 'x');
  if (hs.length === 0) return [];
  const b = part.bounds;
  const ys = uniq(hs.map((h) => h.y));
  const zs = uniq(hs.map((h) => h.z));
  const back = zs[0]!;
  return [
    {
      side: 'left',
      row: 0,
      points: [
        { at: b.y, from: b.z },
        { at: ys[0]!, from: back },
        { at: ys[ys.length - 1]!, from: back },
        { at: b.y + b.height, from: b.z },
      ],
    },
    { side: 'top', row: 0, points: [b.z, ...zs, b.z + b.depth].map((at) => ({ at, from: b.y + b.height })) },
  ];
}

/** Chain up the right of a door in the front view (u = x, v = y): door bottom → each hinge cup → door top. */
export function cupChain(door: Part): Chain | null {
  const hs = holesOf(door).filter((h) => h.axis === 'z');
  if (hs.length === 0) return null;
  const b = door.bounds;
  const from = b.x + b.width;
  return { side: 'right', row: 0, points: [b.y, ...uniq(hs.map((h) => h.y)), b.y + b.height].map((at) => ({ at, from })) };
}

/** Distance from a hole's center to the nearer vertical edge of its part (e.g. hinge cup boring distance). */
export function edgeDistance(part: Part, h: PartFeature): Ticks {
  return Math.min(h.x - part.bounds.x, part.bounds.x + part.bounds.width - h.x);
}
