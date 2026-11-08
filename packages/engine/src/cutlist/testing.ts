/** Test helpers for the cut list module (not exported from the package). */
import type { Part, PartRole, RunResult } from '../derived';
import type { Material, Project } from '../model';
import { createDefaultProject } from '../defaults';
import { inches } from '../units';
import type { NestRect } from './guillotine';

/** Seeded PRNG (mulberry32), for reproducible random tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Independent check that rectangles form a guillotine layout inside `region` with `kerf`:
 * some straight cut across the region (whose kerf touches no rectangle) separates them into two
 * non-empty sets, recursively, down to single rectangles.
 */
export function isGuillotine(rects: readonly NestRect[], region: NestRect, kerf: number): boolean {
  if (rects.length <= 1) return true;
  for (const axis of ['x', 'y'] as const) {
    const pos = (r: NestRect) => (axis === 'x' ? r.x : r.y);
    const size = (r: NestRect) => (axis === 'x' ? r.w : r.h);
    const end = pos(region) + size(region);
    const cands = [...new Set(rects.map((r) => pos(r) + size(r)))].sort((a, b) => a - b);
    for (const c of cands) {
      const before = rects.filter((r) => pos(r) + size(r) <= c);
      const after = rects.filter((r) => pos(r) >= c + kerf);
      if (before.length === 0 || after.length === 0 || before.length + after.length !== rects.length) continue;
      const a: NestRect = axis === 'x' ? { ...region, w: c - region.x } : { ...region, h: c - region.y };
      const b: NestRect = axis === 'x' ? { x: c + kerf, y: region.y, w: end - c - kerf, h: region.h } : { x: region.x, y: c + kerf, w: region.w, h: end - c - kerf };
      return isGuillotine(before, a, kerf) && isGuillotine(after, b, kerf);
    }
  }
  return false;
}

/** No two rectangles overlap or come closer than `kerf` (on the axis that separates them). */
export function kerfSeparated(rects: readonly NestRect[], kerf: number): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      const apartX = a.x + a.w + kerf <= b.x || b.x + b.w + kerf <= a.x;
      const apartY = a.y + a.h + kerf <= b.y || b.y + b.h + kerf <= a.y;
      if (!apartX && !apartY) return false;
    }
  }
  return true;
}

export const inside = (r: NestRect, area: NestRect): boolean => r.x >= area.x && r.y >= area.y && r.x + r.w <= area.x + area.w && r.y + r.h <= area.y + area.h;

/** A minimal RunResult holding just `parts`. */
export function fakeResult(parts: Part[], runId = 'run-1', extra: Partial<RunResult> = {}): RunResult {
  return { runId, width: 0, ceilingHeight: 0, ceilingGap: 0, tiers: [], boxes: [], gaps: [], frames: [], parts, issues: [], ...extra };
}

let seq = 0;
/** A part with sensible defaults (3/4 ply side, owner 'box-1'). Sizes in inches. */
export function fakePart(o: { length: number; width: number; thickness?: number; materialId?: string; role?: PartRole; name?: string; ownerId?: string; id?: string }): Part {
  const t = inches(o.thickness ?? 23 / 32);
  return {
    id: o.id ?? `p${++seq}`,
    name: o.name ?? 'Part',
    role: o.role ?? 'side',
    materialId: o.materialId ?? 'ply-23-32',
    length: inches(o.length),
    width: inches(o.width),
    thickness: t,
    bounds: { x: 0, y: 0, z: 0, width: inches(o.width), height: inches(o.length), depth: t },
    ownerId: o.ownerId ?? 'box-1',
  };
}

/** Default project with extra materials. */
export function projectWith(...materials: Material[]): Project {
  const p = createDefaultProject();
  return { ...p, materials: [...p.materials, ...materials] };
}
