/**
 * Continuous face frames. Boxes whose fronts are coplanar and that touch (side by side or
 * stacked) form one frame group. Stiles are derived per group at each vertical boundary:
 *  - Shared stile between two boxes: covers both sides (side thickness + lip on each).
 *  - End stile at a wall: runs from the wall (scribe space) to the box's inside face.
 *  - End stile elsewhere (open end, next to a gap or a set-back box): flush with the side.
 * Rails are per box (see box.ts).
 */
import type { FrameGroup, Part } from '../derived';
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

export function deriveFrames(ctx: Ctx, boxes: readonly PlacedBox[], runWidth: Ticks): { frames: FrameGroup[]; parts: Part[] } {
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
        const leftCover = leftBoxes.length
          ? Math.max(...leftBoxes.map((m) => m.cover))
          : rightBoxes.some((m) => m.box.atLeftWall)
            ? x
            : 0;
        const rightCover = rightBoxes.length
          ? Math.max(...rightBoxes.map((m) => m.cover))
          : leftBoxes.some((m) => m.box.atRightWall)
            ? runWidth - x
            : 0;
        const y0 = Math.min(...run.map((m) => m.y0));
        const y1 = Math.max(...run.map((m) => m.y1));
        const width = snap(leftCover + rightCover, ctx.grid);
        const owner = rightBoxes[0] ?? leftBoxes[0]!;
        const side = rightBoxes[0] ? 'left' : 'right';
        const atWall = (!leftBoxes.length && leftCover > 0) || (!rightBoxes.length && rightCover > 0);
        const shared = leftBoxes.length > 0 && rightBoxes.length > 0;
        parts.push(
          makePart({
            id: `${owner.box.id}/stile-${side}`,
            name: shared ? 'Shared stile' : atWall ? 'Scribe stile' : 'End stile',
            role: 'stile',
            materialId: owner.box.settings.materials.faceFrame,
            bounds: { x: x - leftCover, y: y0, z: owner.front, width, height: y1 - y0, depth: owner.tf },
            grain: 'vertical',
            thicknessAxis: 'z',
            ownerId: owner.box.id as Id,
          }),
        );
      }
    }
  }
  return { frames, parts };
}
