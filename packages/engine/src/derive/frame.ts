/**
 * Continuous face frames. Boxes whose fronts are coplanar and that touch (side by side or
 * stacked) form one frame group. Stiles are derived per group at each vertical boundary:
 *  - Shared stile between two boxes: covers both sides (side thickness + lip on each).
 *  - End stile at a wall: runs from the wall (scribe space) to the box's inside face.
 *  - End stile elsewhere (open end, next to a gap or a set-back box): flush with the side by
 *    default; with `faceFrame.endStiles.<side> = 'full'` it is as wide as a shared stile and
 *    centered on the box edge, overhanging the side (so it lines up with stiles above/below).
 *    Layout reserves room for that overhang, and an end panel (a doubled side) fills in behind
 *    it so the exposed end is flush with the stile's outer edge.
 * Rails are per box (see box.ts).
 */
import type { FrameGroup, Part, Rect } from '../derived';
import type { Id } from '../model';
import { snap, type Ticks } from '../units';
import { makePart, type Ctx } from './context';
import type { PlacedBox } from './layout';

interface Edges {
  box: PlacedBox;
  x0: Ticks;
  x1: Ticks;
  y0: Ticks;
  y1: Ticks;
  front: Ticks;
  cover: Ticks; // side thickness + lip
  tf: Ticks;
}

type CoverKind = 'box' | 'wall' | 'full' | 'flush';

const maxCover = (ms: readonly Edges[]): Ticks => Math.max(...ms.map((m) => m.cover));

/**
 * How far a stile on a vertical line extends to one `side` of it. `near` are the boxes on that
 * side of the line; `far` are the boxes on the other side, whose `side` edge is on the line.
 */
function sideCover(near: readonly Edges[], far: readonly Edges[], side: 'left' | 'right', toWall: Ticks): { cover: Ticks; kind: CoverKind } {
  if (near.length) return { cover: maxCover(near), kind: 'box' };
  if (far.some((m) => (side === 'left' ? m.box.atLeftWall : m.box.atRightWall))) return { cover: toWall, kind: 'wall' };
  if (far.some((m) => m.box.settings.faceFrame.endStiles[side] === 'full')) return { cover: maxCover(far), kind: 'full' };
  return { cover: 0, kind: 'flush' };
}

export function deriveFrames(
  ctx: Ctx,
  boxes: readonly PlacedBox[],
  runWidth: Ticks,
  gaps: readonly { spanId: Id; rect: Rect }[] = [],
): { frames: FrameGroup[]; parts: Part[] } {
  const edges: Edges[] = boxes.map((b) => ({
    box: b,
    x0: b.carcass.x,
    x1: b.carcass.x + b.carcass.width,
    y0: b.carcass.y,
    y1: b.carcass.y + b.carcass.height,
    front: b.carcass.z + b.carcass.depth,
    cover: ctx.thickness(b.settings.materials.carcass, b.id) + b.settings.faceFrame.lip,
    tf: ctx.thickness(b.settings.materials.faceFrame, b.id),
  }));

  // ---- Union-find into groups ----
  const parent = edges.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i]!;
      const b = edges[j]!;
      if (a.front !== b.front) continue;
      const vOverlap = a.y0 < b.y1 && b.y0 < a.y1;
      const hOverlap = a.x0 < b.x1 && b.x0 < a.x1;
      const sideBySide = vOverlap && (a.x1 === b.x0 || b.x1 === a.x0);
      const stacked = hOverlap && (a.y1 === b.y0 || b.y1 === a.y0);
      if (sideBySide || stacked) union(i, j);
    }
  }
  const groups = new Map<number, Edges[]>();
  edges.forEach((e, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(e);
    groups.set(root, list);
  });

  const frames: FrameGroup[] = [];
  const parts: Part[] = [];
  for (const members of groups.values()) {
    const sorted = [...members].sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
    const groupId = `frame-${sorted[0]!.box.id}`;
    frames.push({ id: groupId, z: sorted[0]!.front, boxIds: sorted.map((m) => m.box.id) });

    const xs = [...new Set(sorted.flatMap((m) => [m.x0, m.x1]))].sort((a, b) => a - b);
    for (const x of xs) {
      // Boxes touching this vertical line, as y-intervals; merge into continuous stiles.
      const touching = sorted
        .filter((m) => m.x0 === x || m.x1 === x)
        .sort((a, b) => a.y0 - b.y0);
      const runs: Edges[][] = [];
      let cur: Edges[] = [];
      let curTop = Number.NEGATIVE_INFINITY;
      for (const m of touching) {
        if (cur.length > 0 && m.y0 > curTop) {
          runs.push(cur);
          cur = [];
        }
        cur.push(m);
        curTop = Math.max(curTop, m.y1);
      }
      if (cur.length > 0) runs.push(cur);

      for (const run of runs) {
        const leftBoxes = run.filter((m) => m.x1 === x);
        const rightBoxes = run.filter((m) => m.x0 === x);
        const left = sideCover(leftBoxes, rightBoxes, 'left', x);
        const right = sideCover(rightBoxes, leftBoxes, 'right', runWidth - x);
        const y0 = Math.min(...run.map((m) => m.y0));
        const y1 = Math.max(...run.map((m) => m.y1));
        const width = snap(left.cover + right.cover, ctx.grid);
        const owner = rightBoxes[0] ?? leftBoxes[0]!;
        const side = rightBoxes[0] ? 'left' : 'right';
        const name =
          left.kind === 'box' && right.kind === 'box' ? 'Shared stile' : left.kind === 'wall' || right.kind === 'wall' ? 'Scribe stile' : 'End stile';
        parts.push(
          makePart({
            id: `${owner.box.id}/stile-${side}`,
            name,
            role: 'stile',
            materialId: owner.box.settings.materials.faceFrame,
            bounds: { x: x - left.cover, y: y0, z: owner.front, width, height: y1 - y0, depth: owner.tf },
            grain: 'vertical',
            thicknessAxis: 'z',
            ownerId: owner.box.id as Id,
          }),
        );
        if (left.kind === 'full') {
          checkOverhang(ctx, edges, gaps, owner.box.id, { x0: x - left.cover, x1: x, y0, y1 });
          for (const m of rightBoxes) if (m.box.settings.faceFrame.endStiles.left === 'full') parts.push(endPanel(ctx, m, 'left'));
        }
        if (right.kind === 'full') {
          checkOverhang(ctx, edges, gaps, owner.box.id, { x0: x, x1: x + right.cover, y0, y1 });
          for (const m of leftBoxes) if (m.box.settings.faceFrame.endStiles.right === 'full') parts.push(endPanel(ctx, m, 'right'));
        }
      }
    }
  }
  return { frames, parts };
}

/** A doubled side behind a full-width end stile's overhang, flush with the stile's outer edge. */
function endPanel(ctx: Ctx, m: Edges, side: 'left' | 'right'): Part {
  const t = ctx.thickness(m.box.settings.materials.carcass, m.box.id);
  const x = side === 'left' ? m.x0 - m.cover : m.x1 + m.cover - t;
  const z = m.box.carcass.z;
  return makePart({
    id: `${m.box.id}/end-panel-${side}`,
    name: 'End panel',
    role: 'side',
    materialId: m.box.settings.materials.carcass,
    bounds: { x, y: m.y0, z, width: t, height: m.y1 - m.y0, depth: m.front - z },
    grain: 'vertical',
    thicknessAxis: 'x',
    ownerId: m.box.id,
  });
}

/** Lint a full-width end stile's overhang: it must not run into another box, and narrows any gap it reaches. */
function checkOverhang(
  ctx: Ctx,
  edges: readonly Edges[],
  gaps: readonly { spanId: Id; rect: Rect }[],
  boxId: Id,
  o: { x0: Ticks; x1: Ticks; y0: Ticks; y1: Ticks },
): void {
  const hits = (x0: Ticks, x1: Ticks, y0: Ticks, y1: Ticks) => x0 < o.x1 && o.x0 < x1 && y0 < o.y1 && o.y0 < y1;
  if (edges.some((e) => hits(e.x0, e.x1, e.y0, e.y1))) {
    ctx.issue('warning', 'end-stile-overlap', boxId, 'A full-width end stile overhangs a neighboring box with a different face plane. Use a flush end stile here.');
  }
  for (const g of gaps) {
    const r = g.rect;
    if (!hits(r.x, r.x + r.width, r.y, r.y + r.height)) continue;
    const name = ctx.run.spans.find((sp) => sp.id === g.spanId)?.name;
    const into = Math.min(o.x1, r.x + r.width) - Math.max(o.x0, r.x);
    ctx.issue('info', 'end-stile-in-gap', boxId, `A full-width end stile overhangs ${ctx.fmt(into)} into ${name ? `"${name}"` : 'the gap'}.`);
  }
}
