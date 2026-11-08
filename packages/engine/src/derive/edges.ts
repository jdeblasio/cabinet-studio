/**
 * Exposed raw plywood edges: edges of sheet-good parts that aren't banded and that nothing hides.
 * An edge is hidden where, just outside it, there's
 *  - another part (touching it, or within a clearance like an adjustable shelf's 1/32"),
 *  - the inside of another box (e.g. a side's top edge under the box above), or the closed
 *    space behind a toe kick,
 *  - the wall, the floor, the ceiling scribe gap, or the scribe gap at a wall end.
 * Exposed stretches are recorded on the part (`Part.rawEdges`), and reported per box. With
 * `edgeBanding.exposed` on, they're banded instead.
 */
import type { Bounds, EdgeFace, Part, RawEdge } from '../derived';
import type { ConstructionSettings, Run } from '../model';
import { inches, type Ticks } from '../units';
import type { Ctx } from './context';
import type { RunLayoutResult } from './layout';

type Axis = 'x' | 'y' | 'z';

const FACE: Record<EdgeFace, { axis: Axis; dir: 1 | -1 }> = {
  left: { axis: 'x', dir: -1 },
  right: { axis: 'x', dir: 1 },
  bottom: { axis: 'y', dir: -1 },
  top: { axis: 'y', dir: 1 },
  back: { axis: 'z', dir: -1 },
  front: { axis: 'z', dir: 1 },
};
const FACES = Object.keys(FACE) as EdgeFace[];

const lo = (b: Bounds, a: Axis) => (a === 'x' ? b.x : a === 'y' ? b.y : b.z);
const ext = (b: Bounds, a: Axis) => (a === 'x' ? b.width : a === 'y' ? b.height : b.depth);
const hi = (b: Bounds, a: Axis) => lo(b, a) + ext(b, a);

/** The axis a panel's thickness runs along. */
export function thicknessAxis(p: Pick<Part, 'bounds' | 'thickness'>): Axis {
  const b = p.bounds;
  return b.depth === p.thickness ? 'z' : b.height === p.thickness ? 'y' : b.width === p.thickness ? 'x' : 'z';
}

/** The axis an edge face runs along (neither its normal nor the part's thickness). */
export function edgeAxis(face: EdgeFace, thickness: Axis): Axis {
  const n = FACE[face].axis;
  return (['x', 'y', 'z'] as const).find((a) => a !== n && a !== thickness)!;
}

/** How far outside an edge to look for what covers it (more than shelf side clearances). */
const PROBE = inches(1 / 16);
/** Shortest exposed stretch worth reporting. */
const MIN_RUN = inches(1 / 2);
/** Undersides at most this high aren't seen (from standing or sitting). */
const LOW_UNDERSIDE = inches(6);
/** Spacing of the probes along an edge. */
const STEP = inches(1);

interface Region {
  ownerId: string;
  bounds: Bounds;
}

/** Closed spaces: each box's carcass, plus the space behind its toe kick down to the floor. */
function enclosures(ctx: Ctx, layout: RunLayoutResult): Region[] {
  const out: Region[] = [];
  for (const b of layout.boxes) {
    out.push({ ownerId: b.id, bounds: b.carcass });
    const tier = ctx.run.tiers.find((t) => t.id === b.tierId);
    const tl = layout.tiers.find((t) => t.tierId === b.tierId);
    if (tier?.toeKick && tl && tl.toeKick > 0 && b.carcass.y === tl.y + tl.toeKick) {
      const c = b.carcass;
      out.push({ ownerId: b.id, bounds: { x: c.x, y: tl.y, z: c.z, width: c.width, height: tl.toeKick, depth: Math.max(0, c.depth - tier.toeKick.setback) } });
    }
  }
  return out;
}

const inside = (b: Bounds, p: Record<Axis, number>, tol: Ticks) =>
  p.x >= b.x - tol && p.x <= b.x + b.width + tol && p.y >= b.y - tol && p.y <= b.y + b.height + tol && p.z >= b.z - tol && p.z <= b.z + b.depth + tol;
const strictlyInside = (b: Bounds, p: Record<Axis, number>) => p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height && p.z > b.z && p.z < b.z + b.depth;

/** Exposed stretches of a part's unbanded edges. */
function exposedOf(p: Part, parts: readonly Part[], spaces: readonly Region[], run: Run, layout: RunLayoutResult, tol: Ticks): RawEdge[] {
  const b = p.bounds;
  const t = thicknessAxis(p);
  const out: RawEdge[] = [];
  // Edges facing a wall end within this distance can't be seen.
  const wallZone = inches(1) + tol + Math.max(0, ...layout.tiers.map((tl) => Math.max(tl.scribe.left, tl.scribe.right)));
  const ceilingZone = layout.ceilingHeight - layout.ceilingGap - tol;
  for (const face of FACES) {
    const { axis: n, dir } = FACE[face];
    if (n === t || p.bandedEdges?.includes(face)) continue;
    const plane = dir > 0 ? hi(b, n) : lo(b, n);
    // Against the wall, the floor, the ceiling gap or a wall-end scribe gap: never seen.
    if (n === 'z' && dir < 0 && plane <= tol) continue;
    // Undersides this close to the floor (e.g. over the toe kick space) aren't seen.
    if (n === 'y' && dir < 0 && plane <= LOW_UNDERSIDE) continue;
    if (n === 'y' && dir > 0 && plane >= ceilingZone) continue;
    if (n === 'x' && dir < 0 && run.ends.left === 'wall' && plane <= wallZone) continue;
    if (n === 'x' && dir > 0 && run.ends.right === 'wall' && plane >= layout.width - wallZone) continue;

    const along = edgeAxis(face, t);
    const probe = plane + dir * PROBE;
    const mid = lo(b, t) + ext(b, t) / 2;
    const a0 = lo(b, along);
    const a1 = hi(b, along);
    // Only parts and spaces reaching the probe line can cover it.
    const line: Bounds = { x: 0, y: 0, z: 0, width: 0, height: 0, depth: 0 };
    const set = (ax: Axis, v: number, e: number) => {
      if (ax === 'x') Object.assign(line, { x: v, width: e });
      else if (ax === 'y') Object.assign(line, { y: v, height: e });
      else Object.assign(line, { z: v, depth: e });
    };
    set(n, probe, 0);
    set(t, mid, 0);
    set(along, a0, a1 - a0);
    const meets = (q: Bounds, pad: Ticks) =>
      ['x', 'y', 'z'].every((ax) => lo(q, ax as Axis) - pad <= hi(line, ax as Axis) && hi(q, ax as Axis) + pad >= lo(line, ax as Axis));
    const covers = parts.filter((q) => q !== p && meets(q.bounds, tol));
    const rooms = spaces.filter((s) => s.ownerId !== p.ownerId && meets(s.bounds, 0));

    const steps = Math.max(2, Math.min(96, Math.ceil((a1 - a0) / STEP)));
    const cell = (a1 - a0) / steps;
    let runStart: number | null = null;
    const flush = (end: number) => {
      if (runStart !== null && end - runStart >= MIN_RUN) out.push({ face, axis: along, from: Math.round(runStart), to: Math.round(end) });
      runStart = null;
    };
    for (let i = 0; i < steps; i++) {
      const at = a0 + cell * (i + 0.5);
      const pt = { x: 0, y: 0, z: 0 } as Record<Axis, number>;
      pt[n] = probe;
      pt[t] = mid;
      pt[along] = at;
      // In the scribe gap at a wall end (behind the scribe stile or filler) of the tier it's in.
      const tl = layout.tiers.find((x) => pt.y >= x.y && pt.y <= x.y + x.height);
      const atWall = !!tl && ((run.ends.left === 'wall' && pt.x <= tl.scribe.left + tol) || (run.ends.right === 'wall' && pt.x >= layout.width - tl.scribe.right - tol));
      const hidden = atWall || covers.some((q) => inside(q.bounds, pt, tol)) || rooms.some((s) => strictlyInside(s.bounds, pt));
      if (hidden) flush(a0 + cell * i);
      else if (runStart === null) runStart = a0 + cell * i;
    }
    flush(a1);
  }
  return out;
}

const FACE_WORD: Record<EdgeFace, string> = { left: 'left', right: 'right', bottom: 'bottom', top: 'top', back: 'back', front: 'front' };

/**
 * Find exposed raw edges of sheet-good parts (in place: `rawEdges`, or banding where
 * `edgeBanding.exposed` is on), and report them per owner.
 */
export function markRawEdges(ctx: Ctx, layout: RunLayoutResult, parts: Part[], settingsFor: (ownerId: string) => ConstructionSettings): void {
  const sheet = new Set(ctx.project.materials.filter((m) => m.kind === 'sheet').map((m) => m.id));
  const spaces = enclosures(ctx, layout);
  const tol = ctx.grid;
  const found: { index: number; edges: RawEdge[] }[] = [];
  parts.forEach((p, index) => {
    if (!sheet.has(p.materialId) || p.role === 'molding') return;
    const edges = exposedOf(p, parts, spaces, ctx.run, layout, tol);
    if (edges.length) found.push({ index, edges });
  });

  const report = new Map<string, Set<string>>();
  for (const { index, edges } of found) {
    const p = parts[index]!;
    const s = settingsFor(p.ownerId);
    const eb = s.edgeBanding;
    if (eb?.exposed) {
      // Band each exposed edge whole; solid edging comes off the cut size across that edge.
      const faces = [...new Set(edges.map((e) => e.face))];
      const t = thicknessAxis(p);
      let { length, width } = p;
      let banding = p.banding ?? 0;
      for (const face of faces) {
        const along = edgeAxis(face, t);
        const across = FACE[face].axis;
        banding += ext(p.bounds, along);
        if (eb.thickness > 0) {
          const e = ext(p.bounds, across);
          if (Math.abs(length - e) <= Math.abs(width - e)) length -= eb.thickness;
          else width -= eb.thickness;
        }
      }
      const words = faces.map((f) => FACE_WORD[f]).join(' and ');
      parts[index] = {
        ...p,
        length,
        width,
        banding,
        bandedEdges: [...(p.bandedEdges ?? []), ...faces],
        note: [p.note, `Band the exposed ${words} edge${faces.length > 1 ? 's' : ''}${eb.thickness > 0 ? ` (cut ${ctx.fmt(eb.thickness)} under per banded edge)` : ''}`].filter(Boolean).join('; '),
      };
      continue;
    }
    parts[index] = { ...p, rawEdges: edges };
    const list = report.get(p.ownerId) ?? new Set<string>();
    for (const face of new Set(edges.map((e) => e.face))) list.add(`${p.name.toLowerCase()} (${FACE_WORD[face]})`);
    report.set(p.ownerId, list);
  }

  for (const [ownerId, list] of report) {
    const items = [...list];
    const shown = items.length <= 4 ? items.join(', ') : `${items.slice(0, 4).join(', ')} and ${items.length - 4} more`;
    ctx.issue(
      'info',
      'raw-edges',
      ownerId,
      `Exposed plywood edge${items.length === 1 ? '' : 's'} with no banding: ${shown}. Turn on "Band exposed edges" (Construction) to band ${items.length === 1 ? 'it' : 'them'}, or cover ${items.length === 1 ? 'it' : 'them'}.`,
    );
  }
}
