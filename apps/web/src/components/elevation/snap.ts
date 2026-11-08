/**
 * Alignment snapping for boundary drags. A dragged boundary within a few pixels of a box edge,
 * gap edge or split line elsewhere in the run snaps to it exactly. Flex boxes re-flow and their
 * sizes snap down to the grid, so the first guess can land a grid step off. To prevent that,
 * nearby grid steps are tried and the one whose derived boundary lands on the target is kept.
 */
import { resizeBoundary, type BoxLayout, type Id, type Project, type RunResult, type Ticks } from '@built-in-planner/engine';
import { produce } from 'immer';
import { getRunResult } from '../../store/derived';
import type { BoundaryHandle } from './geometry';

export interface SnapGuide {
  axis: 'x' | 'y';
  pos: Ticks;
}

export interface DragSolution {
  project: Project;
  /** Set when the boundary landed exactly on an alignment target. */
  guide?: SnapGuide;
}

/** Grid steps to try around the snapped position, nearest first. */
const NUDGES = [0, -1, 1, -2, 2, -3, 3];

/** Boundaries between consecutive children of each split in a box, on one axis. */
function splitLines(box: BoxLayout, axis: 'x' | 'y'): Ticks[] {
  const out: Ticks[] = [];
  for (const split of box.sections) {
    if (split.kind !== 'split') continue;
    const children = box.sections.filter((s) => s.parentId === split.sectionId);
    for (let i = 0; i + 1 < children.length; i++) {
      const a = children[i]!.rect;
      const b = children[i + 1]!.rect;
      const rows = a.x === b.x && a.width === b.width;
      // Rows run top → bottom; columns left → right (matches computeHandles).
      if (rows && axis === 'y') out.push((a.y + b.y + b.height) / 2);
      if (!rows && axis === 'x') out.push((a.x + a.width + b.x) / 2);
    }
  }
  return out;
}

/** Positions a handle can snap to: edges and split lines of boxes that don't move with it, and gap edges. */
export function snapTargets(result: RunResult, handle: BoundaryHandle): Ticks[] {
  if (!handle.snap) return [];
  const exclude = new Set<Id>(handle.snap.exclude);
  const out = new Set<Ticks>();
  for (const box of result.boxes) {
    if (exclude.has(box.id)) continue;
    if (handle.axis === 'x') {
      out.add(box.carcass.x);
      out.add(box.carcass.x + box.carcass.width);
    }
    for (const pos of splitLines(box, handle.axis)) out.add(pos);
  }
  if (handle.axis === 'x') {
    for (const g of result.gaps) {
      out.add(g.rect.x);
      out.add(g.rect.x + g.rect.width);
    }
  }
  return [...out];
}

/**
 * The project after dragging `handle` by `move` (world ticks along its axis, positive = right/up),
 * starting from `base`. With `snap`, a boundary within `threshold` of a target lands on it.
 */
export function solveDrag(
  base: Project,
  runId: Id,
  handle: BoundaryHandle,
  move: Ticks,
  opts: { grid: Ticks; threshold: Ticks; snap: boolean },
): DragSolution {
  const attempt = (m: Ticks): Project => {
    const res = resizeBoundary(handle.a, handle.b, handle.sign * m, { grid: opts.grid, minSize: handle.minSize });
    return produce(base, (d) => handle.apply(d, res.a, res.b));
  };
  const measure = handle.snap?.measure;
  if (opts.snap && measure) {
    const want = handle.pos + move;
    let target: Ticks | undefined;
    for (const t of snapTargets(getRunResult(base, runId), handle)) {
      const d = Math.abs(t - want);
      if (d <= opts.threshold && (target === undefined || d < Math.abs(target - want))) target = t;
    }
    if (target !== undefined) {
      let closest: { project: Project; err: Ticks } | undefined;
      for (const k of NUDGES) {
        const project = attempt(target - handle.pos + k * opts.grid);
        const at = measure(getRunResult(project, runId));
        if (at === undefined) continue;
        const err = Math.abs(at - target);
        if (err === 0) return { project, guide: { axis: handle.axis, pos: target } };
        if (!closest || err < closest.err) closest = { project, err };
      }
      // Can't land exactly (e.g. off-grid materials): stay as close as possible, without a guide.
      if (closest) return { project: closest.project };
    }
  }
  return { project: attempt(move) };
}
