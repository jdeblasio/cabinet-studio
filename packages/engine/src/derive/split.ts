/**
 * Splitting parts that are bigger than the stock they're cut from (a sheet, or the longest
 * board), when `settings.splitOversize` is on for the part's box (or tier / run). Each part is
 * pieced along one axis with as few joints as possible, putting joints where they hide:
 *  - tops, bottoms and fixed shelves: centered on a partition that meets them;
 *  - backs: centered behind a partition (vertical joints) or a fixed shelf (horizontal joints);
 *  - face frame rails: at a mid stile, which then runs through the rail;
 *  - countertops: over the joint between two boxes (or a partition) below;
 *  - sides and partitions: centered on a fixed shelf, bottom or top dadoed into them.
 * Elsewhere joints are spread evenly and noted as visible. With splitting off, oversize parts are
 * reported instead. Stock limits come from the cut list options (sheet size less edge trim and
 * grain; longest board less end trim).
 */
import type { Bounds, HardwareItem, Part, PartRole } from '../derived';
import type { ConstructionSettings, Material } from '../model';
import { maxLumberLength } from '../cutlist/cutlist';
import { usableRect } from '../cutlist/guillotine';
import { resolveCutListOptions, type CutListOptions } from '../cutlist/options';
import { inches, snap, type Ticks } from '../units';
import type { Ctx } from './context';

type Axis = 'x' | 'y';

/** Parts never split: fronts and drawer parts (a seam would show or weaken them), shelves that must lift out, moldings (bought by length) and toe kicks (already pieced). */
const NEVER: ReadonlySet<PartRole> = new Set(['door', 'drawerFront', 'frontFrame', 'frontPanel', 'drawerBox', 'drawerBottom', 'adjustableShelf', 'molding', 'toeKick']);

/** A place a joint can hide: pieces end at `from` and resume at `to` (a stile's width, or one point). */
interface Seam {
  from: Ticks;
  to: Ticks;
  /** Why it hides there, for the cut list note. */
  why: string;
  /** A mid stile to run through the rail (rails only). */
  stileId?: string;
}

const lo = (b: Bounds, a: Axis) => (a === 'x' ? b.x : b.y);
const ext = (b: Bounds, a: Axis) => (a === 'x' ? b.width : b.height);
const hi = (b: Bounds, a: Axis) => lo(b, a) + ext(b, a);
const near = (a: Ticks, b: Ticks, tol: Ticks) => Math.abs(a - b) <= tol;

/**
 * The axes (x or y; parts are never split through their depth) a part could be split along,
 * with its cut size along each (length or width) and across it.
 */
function faceAxes(p: Part): { axis: Axis; cut: Ticks; cross: Ticks; alongLength: boolean }[] {
  const b = p.bounds;
  const thicknessAxis = b.depth === p.thickness ? 'z' : b.height === p.thickness ? 'y' : b.width === p.thickness ? 'x' : 'z';
  return (['x', 'y'] as const)
    .filter((axis) => axis !== thicknessAxis)
    .map((axis) => {
      const e = ext(b, axis);
      // Cut sizes can differ from the bounds by joint allowances; match the closer one.
      const alongLength = Math.abs(p.length - e) <= Math.abs(p.width - e);
      return { axis, cut: alongLength ? p.length : p.width, cross: alongLength ? p.width : p.length, alongLength };
    });
}

/**
 * The longest piece (along one axis) that still fits the stock, given the piece's size across
 * that axis; null when the cross size doesn't fit either (splitting this way can't help).
 */
export function maxPiece(m: Material, alongLength: boolean, cross: Ticks, opts: CutListOptions): Ticks | null {
  if (m.kind === 'lumber') return alongLength ? maxLumberLength(opts.lumber) || null : null;
  if (!m.sheet) return null;
  const area = usableRect({ length: m.sheet.length, width: m.sheet.width, kerf: opts.sheet.kerf, trim: opts.sheet.trim });
  if (!area) return null;
  const rot = !(opts.sheet.respectGrain && m.sheet.grain === 'length');
  // Unrotated, the part's length runs along the sheet length (area.w).
  const options: Ticks[] = [];
  if (alongLength) {
    if (cross <= area.h) options.push(area.w);
    if (rot && cross <= area.w) options.push(area.h);
  } else {
    if (cross <= area.w) options.push(area.h);
    if (rot && cross <= area.h) options.push(area.w);
  }
  return options.length ? Math.max(...options) : null;
}

/** Whether a part fits its stock as it is. */
function fits(m: Material, p: Part, opts: CutListOptions): boolean {
  if (m.kind === 'lumber') return p.length <= maxLumberLength(opts.lumber);
  const max = maxPiece(m, true, p.width, opts);
  return max !== null && p.length <= max;
}

/** Hidden joint positions for a part along an axis, from the parts around it. */
function seamsFor(p: Part, axis: Axis, all: readonly Part[], tol: Ticks): Seam[] {
  const b = p.bounds;
  const inside = (c: Ticks) => c > lo(b, axis) && c < hi(b, axis);
  const out: Seam[] = [];
  const same = all.filter((q) => q.ownerId === p.ownerId && q.id !== p.id);
  const otherAxis: Axis = axis === 'x' ? 'y' : 'x';
  // Does q touch p across the other axis (e.g. a partition right under a top)?
  const touches = (q: Part) => near(hi(q.bounds, otherAxis), lo(b, otherAxis), tol) || near(lo(q.bounds, otherAxis), hi(b, otherAxis), tol);
  const overlapsAcross = (q: Part) => lo(q.bounds, otherAxis) < hi(b, otherAxis) && hi(q.bounds, otherAxis) > lo(b, otherAxis);
  const center = (q: Part) => Math.round(lo(q.bounds, axis) + ext(q.bounds, axis) / 2);

  if (axis === 'x') {
    if (p.role === 'molding') {
      // Over a stile's center (solid backing to nail the scarf to), in the tier the molding runs along.
      for (const q of all) {
        if (q.role !== 'stile') continue;
        const vertical = q.bounds.y <= b.y + b.height + inches(1) && q.bounds.y + q.bounds.height >= b.y - inches(1);
        if (vertical && inside(center(q))) out.push({ from: center(q), to: center(q), why: 'over the stile' });
      }
    } else if (p.role === 'rail') {
      for (const q of same) {
        if (q.role !== 'stile' || !touches(q)) continue;
        if (q.bounds.x > b.x && q.bounds.x + q.bounds.width < b.x + b.width) out.push({ from: q.bounds.x, to: q.bounds.x + q.bounds.width, why: 'at the mid stile, which runs through the rail', stileId: q.id });
      }
    } else if (p.role === 'back') {
      for (const q of same) if (q.role === 'partition' && inside(center(q))) out.push({ from: center(q), to: center(q), why: 'centered behind the partition' });
    } else if (p.role === 'countertop') {
      // Over the joint between two boxes (two carcass sides meeting), or a partition, right below.
      const below = all.filter((q) => (q.role === 'side' || q.role === 'partition') && near(q.bounds.y + q.bounds.height, b.y, tol) && overlapsAcrossZ(q, b));
      for (const q of below) {
        if (q.role === 'partition' && inside(center(q))) out.push({ from: center(q), to: center(q), why: 'over the partition below' });
        if (q.role === 'side') {
          const right = q.bounds.x + q.bounds.width;
          if (inside(right) && below.some((r) => r.role === 'side' && r.ownerId !== q.ownerId && near(r.bounds.x, right, tol))) out.push({ from: right, to: right, why: 'over the joint between the boxes below' });
        }
      }
    } else {
      // Tops, bottoms, fixed shelves (and other horizontal panels): on a partition meeting them,
      // else (e.g. a finished bottom below the bottom) in line with one, under its stile.
      const partitions = same.filter((q) => q.role === 'partition' && inside(center(q)));
      const meeting = partitions.filter(touches);
      if (meeting.length) for (const q of meeting) out.push({ from: center(q), to: center(q), why: 'centered on the partition' });
      else for (const q of partitions) out.push({ from: center(q), to: center(q), why: 'in line with the partition and its stile' });
    }
  } else {
    // Vertical parts: on a fixed shelf, bottom or top dadoed into them (or behind one, for backs).
    for (const q of same) {
      if (q.role !== 'fixedShelf' && q.role !== 'bottom' && q.role !== 'top') continue;
      if (!inside(center(q))) continue;
      if (p.role === 'back' ? overlapsAcross(q) : touches(q)) out.push({ from: center(q), to: center(q), why: p.role === 'back' ? `centered behind the ${q.role === 'fixedShelf' ? 'fixed shelf' : q.role}` : `centered on the ${q.role === 'fixedShelf' ? 'fixed shelf' : q.role}` });
    }
  }
  const unique = new Map(out.map((s) => [`${s.from}:${s.to}`, s]));
  return [...unique.values()].sort((a, c) => a.from - c.from);
}

function overlapsAcrossZ(q: Part, b: Bounds): boolean {
  return q.bounds.z < b.z + b.depth && q.bounds.z + q.bounds.depth > b.z;
}

/**
 * Joints along [a, b] so no piece is longer than `max`: the plan with the fewest visible joints,
 * then the fewest pieces, using hidden seams where they help. Visible joints split what's left
 * between hidden seams evenly (on the grid). Returns the pieces, each with the joint at its end.
 */
export function planPieces(a: Ticks, b: Ticks, max: Ticks, seams: readonly Seam[], grid: Ticks): { from: Ticks; to: Ticks; joint?: Seam }[] {
  // Leave a grid step of slack so evenly placed joints can snap to the grid.
  const limit = Math.max(grid, max - grid);
  const pts = seams.filter((sm) => sm.from > a && sm.to < b).sort((x, y) => x.from - y.from);
  const free = (gap: Ticks) => Math.max(0, Math.ceil(gap / limit) - 1);
  // Fewest visible joints, then fewest pieces, then the most even (shortest longest piece).
  type Step = { visible: number; pieces: number; longest: number; prev: number };
  const better = (x: Step, y: Step | undefined) =>
    !y || x.visible < y.visible || (x.visible === y.visible && (x.pieces < y.pieces || (x.pieces === y.pieces && x.longest < y.longest)));
  const pos = (i: number) => (i < 0 ? a : pts[i]!.to);
  const steps: Step[] = [];
  const reach = (i: number, to: Ticks): Step | undefined => {
    const from = i < 0 ? { visible: 0, pieces: 0, longest: 0 } : steps[i];
    if (!from || to <= pos(i)) return undefined;
    const f = free(to - pos(i));
    return { visible: from.visible + f, pieces: from.pieces + f + 1, longest: Math.max(from.longest, (to - pos(i)) / (f + 1)), prev: i };
  };
  for (let j = 0; j < pts.length; j++) {
    let best: Step | undefined;
    for (let i = -1; i < j; i++) {
      const st = reach(i, pts[j]!.from);
      if (st && better(st, best)) best = st;
    }
    steps[j] = best ?? { visible: Infinity, pieces: Infinity, longest: Infinity, prev: -1 };
  }
  let end: Step | undefined;
  for (let i = -1; i < pts.length; i++) {
    const st = reach(i, b);
    if (st && better(st, end)) end = st;
  }
  // Walk back through the chosen hidden seams, then fill each stretch with even visible joints.
  const chosen: number[] = [];
  for (let i = end?.prev ?? -1; i >= 0; i = steps[i]!.prev) chosen.unshift(i);
  const pieces: { from: Ticks; to: Ticks; joint?: Seam }[] = [];
  let cursor = a;
  const fill = (to: Ticks, joint?: Seam) => {
    const gap = to - cursor;
    const k = free(gap);
    for (let m = 1; m <= k; m++) {
      // Split what's left of the stretch evenly among the pieces still to come.
      const at = snap(cursor + (to - cursor) / (k + 2 - m), grid, 'down');
      pieces.push({ from: cursor, to: at, joint: { from: at, to: at, why: '' } });
      cursor = at;
    }
    pieces.push({ from: cursor, to, ...(joint ? { joint } : {}) });
  };
  for (const i of chosen) {
    fill(pts[i]!.from, pts[i]!);
    cursor = pts[i]!.to;
  }
  fill(b);
  return pieces;
}

const VISIBLE = 'not hidden (no partition, shelf or frame member there): spline or biscuit it, or add a partition to hide it';

/**
 * Split oversize parts (in place) where splitting is on, and report the rest. Mid stiles that a
 * rail is pieced at are extended through the rail. Hardware and drilled holes follow the piece
 * they're on.
 */
export function splitOversizeParts(ctx: Ctx, parts: Part[], hardware: HardwareItem[], settingsFor: (ownerId: string) => ConstructionSettings): void {
  const opts = resolveCutListOptions(ctx.project.cutList);
  const materials = new Map(ctx.project.materials.map((m) => [m.id, m]));
  const tol = ctx.grid;
  const oversize = new Map<string, string[]>();
  const pieceOf = new Map<string, { id: string; axis: Axis; from: Ticks; to: Ticks }[]>();

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const m = materials.get(p.materialId);
    if (!m || fits(m, p, opts)) continue;
    const s = settingsFor(p.ownerId);
    // Moldings are bought by length: a run longer than the longest stick is always spliced
    // (scarf joints, over a stile where possible), whatever the setting.
    const molding = p.role === 'molding';
    // The best axis to split along: the one needing the fewest pieces.
    let best: { axis: Axis; max: Ticks; alongLength: boolean; n: number } | null = null;
    if (molding) {
      const max = maxLumberLength(opts.lumber);
      if (max > 0 && p.bounds.width > ext(p.bounds, 'y')) best = { axis: 'x', max, alongLength: true, n: Math.ceil(p.length / max) };
    } else if (!NEVER.has(p.role)) {
      for (const f of faceAxes(p)) {
        const max = maxPiece(m, f.alongLength, f.cross, opts);
        if (!max) continue;
        const n = Math.ceil(f.cut / max);
        if (!best || n < best.n) best = { axis: f.axis, max, alongLength: f.alongLength, n };
      }
    }
    if (molding && !best) continue;
    if ((!s.splitOversize && !molding) || !best) {
      const list = oversize.get(p.ownerId) ?? [];
      list.push(p.name);
      oversize.set(p.ownerId, list);
      continue;
    }

    const { axis, max, alongLength } = best;
    const a = lo(p.bounds, axis);
    const b = hi(p.bounds, axis);
    const cutAlong = alongLength ? p.length : p.width;
    // Joint allowances (e.g. dado depth) stay on the outer ends; leave room for them in the pieces.
    const extra = cutAlong - (b - a);
    const plan = planPieces(a, b, max - Math.max(0, extra), seamsFor(p, axis, parts, tol), ctx.grid);
    const n = plan.length;
    const pieces: Part[] = plan.map((piece, k) => {
      const e = piece.to - piece.from;
      const cut = e + (k === 0 ? extra / 2 : 0) + (k === n - 1 ? extra / 2 : 0);
      const bounds: Bounds = axis === 'x' ? { ...p.bounds, x: piece.from, width: e } : { ...p.bounds, y: piece.from, height: e };
      const joints = [plan[k - 1]?.joint, piece.joint].filter((j): j is Seam => !!j);
      const jointNote = joints.map((j) => (molding ? `scarf joint ${j.why || 'between stiles: glue and pin it'}` : `joint ${j.why || VISIBLE}`));
      // Worded so identical pieces share one note in the cut list.
      const note = [p.note, `One of ${n} pieces`, ...[...new Set(jointNote)]].filter(Boolean).join('; ');
      const features = p.features?.filter((f) => (axis === 'x' ? f.x : f.y) >= piece.from && (axis === 'x' ? f.x : f.y) <= piece.to);
      const part: Part = {
        ...p,
        id: `${p.id}-piece-${k + 1}`,
        bounds,
        length: alongLength ? Math.round(cut) : p.length,
        width: alongLength ? p.width : Math.round(cut),
        note,
        ...(p.banding ? { banding: Math.round((p.banding * e) / (b - a)) } : {}),
        ...(features?.length ? { features } : {}),
      };
      if (!features?.length) delete part.features;
      return part;
    });
    pieceOf.set(
      p.id,
      pieces.map((q, k) => ({ id: q.id, axis, from: plan[k]!.from, to: plan[k]!.to })),
    );
    parts.splice(i, 1, ...pieces);
    i += pieces.length - 1;

    // Mid stiles a rail is pieced at run through it.
    for (const piece of plan) {
      const stileId = piece.joint?.stileId;
      if (!stileId) continue;
      const si = parts.findIndex((q) => q.id === stileId);
      const st = parts[si];
      if (!st) continue;
      const y0 = Math.min(st.bounds.y, p.bounds.y);
      const y1 = Math.max(st.bounds.y + st.bounds.height, p.bounds.y + p.bounds.height);
      parts[si] = {
        ...st,
        bounds: { ...st.bounds, y: y0, height: y1 - y0 },
        length: st.length + (y1 - y0 - st.bounds.height),
        note: [st.note, 'Runs through the rail, which is pieced here'].filter(Boolean).join('; '),
      };
    }
  }

  // Hardware moves to the piece it's fastened to.
  for (let i = 0; i < hardware.length; i++) {
    const h = hardware[i]!;
    const pieces = pieceOf.get(h.partId);
    if (!pieces) continue;
    const sh = h.shapes[0];
    const c = !sh ? 0 : sh.kind === 'box' ? (pieces[0]!.axis === 'x' ? sh.bounds.x + sh.bounds.width / 2 : sh.bounds.y + sh.bounds.height / 2) : pieces[0]!.axis === 'x' ? sh.x : sh.y;
    const piece = pieces.find((q) => c >= q.from && c <= q.to) ?? pieces[0]!;
    hardware[i] = { ...h, partId: piece.id };
  }

  for (const [ownerId, names] of oversize) {
    const unique = [...new Set(names)];
    const list = unique.length <= 3 ? unique.join(', ') : `${unique.slice(0, 3).join(', ')} and ${unique.length - 3} more`;
    const s = settingsFor(ownerId);
    ctx.issue(
      'warning',
      'part-exceeds-stock',
      ownerId,
      s.splitOversize
        ? `${list} ${unique.length === 1 ? "doesn't" : "don't"} fit your stock and can't be split (a front, drawer part or adjustable shelf, or too wide across). Make the box smaller.`
        : `${list} ${unique.length === 1 ? 'is' : 'are'} bigger than your stock (sheet size or longest board). Turn on "Split oversize parts" to piece ${unique.length === 1 ? 'it' : 'them'} at hidden joints, or make the box smaller.`,
    );
  }
}
