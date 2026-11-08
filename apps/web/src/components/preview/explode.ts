import { TICKS_PER_INCH, type RunResult, type Ticks } from '@built-in-planner/engine';

/** Scene units are inches. */
const I = (t: Ticks) => t / TICKS_PER_INCH;

/** How far each part moves from its box center, as a fraction of its distance from it. */
const PART = 0.35;
/** How far each box (and run-level part) moves from the run center. */
const BOX = 0.25;

/**
 * Exploded view: move each box's parts away from the box center (sides out, top up, fronts
 * forward), and spread boxes apart from the run's center so they don't collide. Then lift and
 * pull everything forward as a whole so no part ends up below the floor or inside the wall.
 * Offsets are in inches.
 */
export function explodeOffsets(result: RunResult): Map<string, [number, number, number]> {
  const centers = new Map(
    result.boxes.map((b) => [b.id, [I(b.carcass.x + b.carcass.width / 2), I(b.carcass.y + b.carcass.height / 2), I(b.carcass.z + b.carcass.depth / 2)] as const]),
  );
  const runCenter = [I(result.width) / 2, I(result.ceilingHeight) / 2, 0] as const;
  const out = new Map<string, [number, number, number]>();
  let minY = 0;
  let minZ = 0;
  for (const p of result.parts) {
    const c = centers.get(p.ownerId);
    const b = p.bounds;
    const pc = [I(b.x + b.width / 2), I(b.y + b.height / 2), I(b.z + b.depth / 2)] as const;
    // Run- or tier-level parts (toe kicks, countertops, moldings) push out from the run center.
    const o: [number, number, number] = c
      ? [(pc[0] - c[0]) * PART + (c[0] - runCenter[0]) * BOX, (pc[1] - c[1]) * PART + (c[1] - runCenter[1]) * BOX, (pc[2] - c[2]) * PART * 2]
      : [(pc[0] - runCenter[0]) * BOX, (pc[1] - runCenter[1]) * BOX, pc[2] * BOX];
    out.set(p.id, o);
    minY = Math.min(minY, I(b.y) + o[1]);
    minZ = Math.min(minZ, I(b.z) + o[2]);
  }
  if (minY < 0 || minZ < 0) {
    for (const o of out.values()) {
      o[1] -= minY;
      o[2] -= minZ;
    }
  }
  return out;
}

/** The extent of all parts (in inches) after moving them by the given offsets. */
export function sceneExtent(result: RunResult, offsets: Map<string, [number, number, number]> | null): { minX: number; maxX: number; maxY: number; maxZ: number } {
  let minX = 0;
  let maxX = I(result.width);
  let maxY = I(result.ceilingHeight);
  let maxZ = 0;
  for (const p of result.parts) {
    const b = p.bounds;
    const o = offsets?.get(p.id) ?? [0, 0, 0];
    minX = Math.min(minX, I(b.x) + o[0]);
    maxX = Math.max(maxX, I(b.x + b.width) + o[0]);
    maxY = Math.max(maxY, I(b.y + b.height) + o[1]);
    maxZ = Math.max(maxZ, I(b.z + b.depth) + o[2]);
  }
  return { minX, maxX, maxY, maxZ };
}
