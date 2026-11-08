/**
 * Guillotine sheet nesting. Every cut runs edge to edge across the piece it divides, so each
 * layout can be cut on a table saw or track saw.
 *
 * Sheet coordinates: x runs along the sheet length from its left end, y across the sheet from
 * its top edge (as drawn). An item's `w` is its size along x when not rotated.
 *
 * Two families of candidate layouts are built and the best one is kept:
 *  - Free-rectangle packing (after Jylänki, "A Thousand Ways to Pack the Bin"): items are placed
 *    one at a time into the free rectangle that fits them best across all open sheets; placing
 *    an item splits its free rectangle with two straight cuts (the order of the two cuts is the
 *    split rule), each cut eating one kerf. A new sheet opens when nothing fits. Every
 *    combination of sort order × fit rule × split rule is tried.
 *  - Strip packing (the panel-saw way): rip a strip as tall as the tallest remaining part, fill
 *    its length with the set of parts that covers the most area (bounded knapsack search), then
 *    fill the holes above shorter parts. Tried with strips along and across the sheet.
 * The layout with the fewest sheets wins, then the one with the biggest single offcut, then the
 * fewest cuts. Cuts that only separate waste from waste are dropped.
 */
import type { Ticks } from '../units';
import type { EdgeTrim } from './options';

export interface NestRect {
  x: Ticks;
  y: Ticks;
  w: Ticks;
  h: Ticks;
}

export interface NestItem {
  /** Size along the sheet length (x) when not rotated. */
  w: Ticks;
  /** Size across the sheet (y) when not rotated. */
  h: Ticks;
  /** May be turned 90° (w along y). */
  canRotate: boolean;
}

export interface NestSheetSpec {
  length: Ticks;
  width: Ticks;
  kerf: Ticks;
  trim: EdgeTrim;
}

/**
 * A guillotine cut tree. A 'cut' divides `rect` with a straight line across it: axis 'x' is the
 * line x = at (a crosscut), axis 'y' the line y = at (a rip along the sheet length). `a` is the
 * piece before the line; the kerf takes [at, at + kerf) and `b` is the rest (null when nothing
 * usable is left past the kerf).
 */
export type CutTree =
  | { kind: 'part'; rect: NestRect; item: number; rotated: boolean }
  | { kind: 'waste'; rect: NestRect }
  | { kind: 'cut'; rect: NestRect; axis: 'x' | 'y'; at: Ticks; a: CutTree; b: CutTree | null };

export interface NestPlacement extends NestRect {
  item: number;
  rotated: boolean;
}

export interface NestCut {
  /** 1-based position in the cut sequence (trims first, then stage by stage). */
  step: number;
  /** 0 = edge trim, 1 = across the whole trimmed sheet, 2 = across a stage-1 piece, and so on. */
  stage: number;
  /** 'rip' runs along the sheet length (constant y); 'cross' runs across it (constant x). */
  direction: 'rip' | 'cross';
  x1: Ticks;
  y1: Ticks;
  x2: Ticks;
  y2: Ticks;
  /** Material the blade removes. */
  kerf: NestRect;
}

export interface NestedSheet {
  /** Cut tree of the trimmed area. */
  tree: CutTree;
  placements: NestPlacement[];
  /** Waste pieces left after cutting, largest first. */
  offcuts: NestRect[];
  cuts: NestCut[];
  partArea: number;
}

export interface NestResult {
  sheets: NestedSheet[];
  /** Items that fit no sheet in any allowed orientation, in input order. */
  unplaced: number[];
  /** Name of the winning strategy (for diagnostics). */
  strategy: string;
}

const SORTS = ['area', 'length', 'width', 'longSide', 'shortSide', 'perimeter'] as const;
const FITS = ['bestArea', 'bestShortSide', 'bestLongSide'] as const;
const SPLITS = ['shorterLeftover', 'longerLeftover', 'minArea', 'maxArea', 'ripFirst', 'crossFirst'] as const;
type SortRule = (typeof SORTS)[number];
type FitRule = (typeof FITS)[number];
type SplitRule = (typeof SPLITS)[number];

/** Mutable node used while packing. Free when it has neither `item` nor `axis`. */
interface MNode {
  rect: NestRect;
  axis?: 'x' | 'y';
  at?: Ticks;
  a?: MNode;
  b?: MNode | null;
  item?: number;
  rotated?: boolean;
}

/** The trimmed area of a sheet, or null if the trim leaves nothing. */
export function usableRect(spec: NestSheetSpec): NestRect | null {
  const { trim } = spec;
  const w = spec.length - trim.left - trim.right;
  const h = spec.width - trim.top - trim.bottom;
  return w > 0 && h > 0 ? { x: trim.left, y: trim.top, w, h } : null;
}

/** Whether an item fits the empty usable area in some allowed orientation. */
export function fitsSheet(item: NestItem, area: NestRect): boolean {
  return (item.w <= area.w && item.h <= area.h) || (item.canRotate && item.h <= area.w && item.w <= area.h);
}

function sortKey(rule: SortRule, it: NestItem): [number, number] {
  const long = Math.max(it.w, it.h);
  const short = Math.min(it.w, it.h);
  switch (rule) {
    case 'area':
      return [it.w * it.h, long];
    case 'length':
      return [it.w, it.h];
    case 'width':
      return [it.h, it.w];
    case 'longSide':
      return [long, short];
    case 'shortSide':
      return [short, long];
    case 'perimeter':
      return [it.w + it.h, long];
  }
}

function order(items: readonly NestItem[], idx: readonly number[], rule: SortRule): number[] {
  const keys = new Map(idx.map((i) => [i, sortKey(rule, items[i]!)] as const));
  return [...idx].sort((p, q) => {
    const a = keys.get(p)!;
    const b = keys.get(q)!;
    return b[0] - a[0] || b[1] - a[1] || p - q;
  });
}

function fitScore(rule: FitRule, r: NestRect, w: Ticks, h: Ticks): [number, number] {
  const dw = r.w - w;
  const dh = r.h - h;
  switch (rule) {
    case 'bestArea':
      return [r.w * r.h - w * h, Math.min(dw, dh)];
    case 'bestShortSide':
      return [Math.min(dw, dh), Math.max(dw, dh)];
    case 'bestLongSide':
      return [Math.max(dw, dh), Math.min(dw, dh)];
  }
}

/** True: cut the full-width line under the item first (y), leaving a strip to cut at x. */
function ripFirst(rule: SplitRule, r: NestRect, w: Ticks, h: Ticks): boolean {
  const dw = r.w - w;
  const dh = r.h - h;
  switch (rule) {
    case 'shorterLeftover':
      return dw <= dh;
    case 'longerLeftover':
      return dw > dh;
    case 'minArea':
      return w * dh > dw * h;
    case 'maxArea':
      return w * dh <= dw * h;
    case 'ripFirst':
      return true;
    case 'crossFirst':
      return false;
  }
}

/** Divide a node at `at` along `axis`; returns the piece before the line and the rest past the kerf. */
function divide(n: MNode, axis: 'x' | 'y', at: Ticks, kerf: Ticks): [MNode, MNode | null] {
  const r = n.rect;
  const end = axis === 'x' ? r.x + r.w : r.y + r.h;
  if (at >= end) return [n, null];
  const a: MNode = { rect: axis === 'x' ? { x: r.x, y: r.y, w: at - r.x, h: r.h } : { x: r.x, y: r.y, w: r.w, h: at - r.y } };
  const bs = at + kerf;
  const b: MNode | null = bs < end ? { rect: axis === 'x' ? { x: bs, y: r.y, w: end - bs, h: r.h } : { x: r.x, y: bs, w: r.w, h: end - bs } } : null;
  n.axis = axis;
  n.at = at;
  n.a = a;
  n.b = b;
  return [a, b];
}

/** Pack all `idx` items (each known to fit an empty sheet) with one strategy. Returns sheet roots. */
function pack(items: readonly NestItem[], idx: readonly number[], area: NestRect, kerf: Ticks, fit: FitRule, split: SplitRule): MNode[] {
  const roots: MNode[] = [];
  const free: MNode[] = [];
  for (const i of idx) {
    const it = items[i]!;
    let best = -1;
    let bestRot = false;
    let s1 = Infinity;
    let s2 = Infinity;
    for (let f = 0; f < free.length; f++) {
      const r = free[f]!.rect;
      for (let o = 0; o < (it.canRotate ? 2 : 1); o++) {
        const w = o ? it.h : it.w;
        const h = o ? it.w : it.h;
        if (w > r.w || h > r.h) continue;
        const [a, b] = fitScore(fit, r, w, h);
        if (a < s1 || (a === s1 && b < s2)) {
          best = f;
          bestRot = o === 1;
          s1 = a;
          s2 = b;
        }
      }
    }
    if (best < 0) {
      const root: MNode = { rect: { ...area } };
      roots.push(root);
      free.push(root);
      best = free.length - 1;
      bestRot = !(it.w <= area.w && it.h <= area.h);
    }
    const node = free[best]!;
    free.splice(best, 1);
    free.push(...placeIn(node, bestRot ? it.h : it.w, bestRot ? it.w : it.h, i, bestRot, kerf, split));
  }
  return roots;
}

/** Orientations of an item that fit a `w` × `h` space: [w, h, rotated], unrotated first. */
function orientations(it: NestItem, w: Ticks, h: Ticks): [Ticks, Ticks, boolean][] {
  const out: [Ticks, Ticks, boolean][] = [];
  if (it.w <= w && it.h <= h) out.push([it.w, it.h, false]);
  if (it.canRotate && it.w !== it.h && it.h <= w && it.w <= h) out.push([it.h, it.w, true]);
  return out;
}

/** Put an item of size w × h at the top-left of a free node, splitting off the rest; returns new free nodes. */
function placeIn(node: MNode, w: Ticks, h: Ticks, item: number, rotated: boolean, kerf: Ticks, split: SplitRule): MNode[] {
  const free: MNode[] = [];
  let target = node;
  const first: 'x' | 'y' = ripFirst(split, node.rect, w, h) ? 'y' : 'x';
  for (const axis of [first, first === 'y' ? 'x' : 'y'] as const) {
    const [a, b] = divide(target, axis, axis === 'x' ? target.rect.x + w : target.rect.y + h, kerf);
    if (b) free.push(b);
    target = a;
  }
  target.item = item;
  target.rotated = rotated;
  return free;
}

/**
 * Choose how many of each size class to add to a strip with `cap` length left: maximize area,
 * each item costing its length plus one kerf. Bounded depth-first search, best ratio first.
 */
function knapsack(classes: readonly { w: Ticks; h: Ticks; n: number }[], cap: number, kerf: Ticks, budget: number): number[] {
  const wt = classes.map((c) => c.w + kerf);
  const val = classes.map((c) => c.w * c.h);
  const best = classes.map(() => 0);
  const take = classes.map(() => 0);
  let bestVal = -1;
  let nodes = 0;
  const bound = (g: number, left: number): number => {
    let v = 0;
    for (let i = g; i < classes.length && left > 0; i++) {
      const k = Math.min(classes[i]!.n, Math.floor(left / wt[i]!));
      v += k * val[i]!;
      left -= k * wt[i]!;
      if (k < classes[i]!.n) return v + (left / wt[i]!) * val[i]!;
    }
    return v;
  };
  const dfs = (g: number, left: number, v: number): void => {
    if (++nodes > budget) return;
    if (v > bestVal) {
      bestVal = v;
      for (let i = 0; i < take.length; i++) best[i] = take[i]!;
    }
    if (g >= classes.length || v + bound(g, left) <= bestVal) return;
    const max = Math.min(classes[g]!.n, Math.floor(left / wt[g]!));
    for (let k = max; k >= 0 && nodes <= budget; k--) {
      take[g] = k;
      dfs(g + 1, left - k * wt[g]!, v + k * val[g]!);
    }
    take[g] = 0;
  };
  dfs(0, cap, 0);
  return best;
}

/**
 * Strip packing along x: each sheet is ripped into strips (constant-y cuts) as tall as their
 * first part; each strip's length is filled by knapsack, and the holes left above shorter parts
 * are filled with whatever still fits. Returns sheet roots.
 */
function packStrips(items: readonly NestItem[], idx: readonly number[], area: NestRect, kerf: Ticks): MNode[] {
  const roots: MNode[] = [];
  let remaining = [...idx];
  const taken = new Set<number>();
  const fillHoles = (holes: MNode[]) => {
    for (const i of remaining) {
      if (taken.has(i)) continue;
      const it = items[i]!;
      let best = -1;
      let bestO: [Ticks, Ticks, boolean] = [0, 0, false];
      let s1 = Infinity;
      for (let hi = 0; hi < holes.length; hi++) {
        const hole = holes[hi]!;
        for (const o of orientations(it, hole.rect.w, hole.rect.h)) {
          const waste = hole.rect.w * hole.rect.h - o[0] * o[1];
          if (waste < s1) {
            s1 = waste;
            best = hi;
            bestO = o;
          }
        }
      }
      if (best < 0) continue;
      const [w, h, rot] = bestO;
      const hole = holes[best]!;
      holes.splice(best, 1, ...placeIn(hole, w, h, i, rot, kerf, 'shorterLeftover'));
      taken.add(i);
    }
    remaining = remaining.filter((i) => !taken.has(i));
  };

  while (remaining.length) {
    const root: MNode = { rect: { ...area } };
    roots.push(root);
    let cur: MNode | null = root;
    const before = remaining.length;
    while (cur && remaining.length) {
      const c: MNode = cur;
      // Leader: the first remaining item that fits, its long side along the strip if it may rotate.
      let leader = -1;
      let lo: [Ticks, Ticks, boolean] | null = null;
      for (const i of remaining) {
        const os = orientations(items[i]!, c.rect.w, c.rect.h);
        if (!os.length) continue;
        leader = i;
        lo = os.reduce((p, q) => (q[0] > p[0] ? q : p));
        break;
      }
      if (leader < 0 || !lo) break;
      const H = lo[1];
      const L = c.rect.w;
      // Size classes of the other items that fit the strip, each in its shortest-length orientation.
      const classes = new Map<string, { w: Ticks; h: Ticks; rot: boolean[]; idx: number[]; n: number }>();
      for (const i of remaining) {
        if (i === leader) continue;
        const os = orientations(items[i]!, L, H);
        if (!os.length) continue;
        const o = os.reduce((p, q) => (q[0] < p[0] ? q : p));
        const key = `${o[0]}x${o[1]}`;
        const cl = classes.get(key);
        if (cl) {
          cl.idx.push(i);
          cl.rot.push(o[2]);
          cl.n++;
        } else classes.set(key, { w: o[0], h: o[1], rot: [o[2]], idx: [i], n: 1 });
      }
      const list = [...classes.values()].sort((a, b) => (b.w * b.h) / (b.w + kerf) - (a.w * a.h) / (a.w + kerf) || b.h - a.h || b.w - a.w);
      const counts = knapsack(list, L - lo[0], kerf, 600);
      const chosen: [number, Ticks, Ticks, boolean][] = [[leader, lo[0], lo[1], lo[2]]];
      list.forEach((cl, g) => {
        for (let k = 0; k < counts[g]!; k++) chosen.push([cl.idx[k]!, cl.w, cl.h, cl.rot[k]!]);
      });
      // Tallest first along the strip.
      chosen.sort((p, q) => q[2] - p[2] || q[1] - p[1] || p[0] - q[0]);

      const [strip, rest] = divide(c, 'y', c.rect.y + H, kerf);
      const holes: MNode[] = [];
      let rowRest: MNode | null = strip;
      for (const [i, w, h, rot] of chosen) {
        if (!rowRest) break;
        const [cell, after]: [MNode, MNode | null] = divide(rowRest, 'x', rowRest.rect.x + w, kerf);
        const [it, below] = divide(cell, 'y', cell.rect.y + h, kerf);
        it.item = i;
        it.rotated = rot;
        taken.add(i);
        if (below) holes.push(below);
        rowRest = after;
      }
      if (rowRest) holes.push(rowRest);
      remaining = remaining.filter((i) => !taken.has(i));
      fillHoles(holes);
      cur = rest;
    }
    if (remaining.length === before) break; // nothing fits an empty sheet (filtered earlier; guard anyway)
  }
  return roots;
}

/** Swap x and y in a mutable tree (to pack strips across the sheet with the same code). */
function transposeNode(n: MNode): void {
  const r = n.rect;
  n.rect = { x: r.y, y: r.x, w: r.h, h: r.w };
  if (n.axis) n.axis = n.axis === 'x' ? 'y' : 'x';
  if (n.a) transposeNode(n.a);
  if (n.b) transposeNode(n.b);
}

/** Freeze a mutable tree, dropping cuts that only separate waste from waste. */
function freeze(n: MNode): CutTree {
  if (n.item !== undefined) return { kind: 'part', rect: n.rect, item: n.item, rotated: n.rotated === true };
  if (!n.axis || !n.a || n.at === undefined) return { kind: 'waste', rect: n.rect };
  const a = freeze(n.a);
  const b = n.b ? freeze(n.b) : null;
  if (a.kind === 'waste' && (!b || b.kind === 'waste')) return { kind: 'waste', rect: n.rect };
  return { kind: 'cut', rect: n.rect, axis: n.axis, at: n.at, a, b };
}

interface Walked {
  placements: NestPlacement[];
  offcuts: NestRect[];
  cuts: { stage: number; seq: number; axis: 'x' | 'y'; at: Ticks; rect: NestRect }[];
}

function walk(t: CutTree, out: Walked, stage: number, parentAxis: 'x' | 'y' | null): void {
  if (t.kind === 'part') {
    out.placements.push({ ...t.rect, item: t.item, rotated: t.rotated });
  } else if (t.kind === 'waste') {
    out.offcuts.push(t.rect);
  } else {
    const s = parentAxis === null ? 1 : parentAxis === t.axis ? stage : stage + 1;
    out.cuts.push({ stage: s, seq: out.cuts.length, axis: t.axis, at: t.at, rect: t.rect });
    walk(t.a, out, s, t.axis);
    if (t.b) walk(t.b, out, s, t.axis);
  }
}

/** Placements, offcuts and the cut sequence of one sheet. */
export function describeSheet(tree: CutTree, spec: NestSheetSpec): NestedSheet {
  const out: Walked = { placements: [], offcuts: [], cuts: [] };
  walk(tree, out, 0, null);
  const { length: L, width: W, kerf, trim } = spec;
  const cuts: NestCut[] = [];
  const add = (c: Omit<NestCut, 'step'>) => cuts.push({ step: cuts.length + 1, ...c });
  // Edge trims: the long edges first, then the ends.
  if (trim.top > 0) add({ stage: 0, direction: 'rip', x1: 0, y1: trim.top, x2: L, y2: trim.top, kerf: { x: 0, y: Math.max(0, trim.top - kerf), w: L, h: Math.min(kerf, trim.top) } });
  if (trim.bottom > 0) add({ stage: 0, direction: 'rip', x1: 0, y1: W - trim.bottom, x2: L, y2: W - trim.bottom, kerf: { x: 0, y: W - trim.bottom, w: L, h: Math.min(kerf, trim.bottom) } });
  const y0 = trim.top;
  const y1 = W - trim.bottom;
  if (trim.left > 0) add({ stage: 0, direction: 'cross', x1: trim.left, y1: y0, x2: trim.left, y2: y1, kerf: { x: Math.max(0, trim.left - kerf), y: y0, w: Math.min(kerf, trim.left), h: y1 - y0 } });
  if (trim.right > 0) add({ stage: 0, direction: 'cross', x1: L - trim.right, y1: y0, x2: L - trim.right, y2: y1, kerf: { x: L - trim.right, y: y0, w: Math.min(kerf, trim.right), h: y1 - y0 } });
  out.cuts.sort((p, q) => p.stage - q.stage || p.seq - q.seq);
  for (const c of out.cuts) {
    const r = c.rect;
    if (c.axis === 'x') {
      add({ stage: c.stage, direction: 'cross', x1: c.at, y1: r.y, x2: c.at, y2: r.y + r.h, kerf: { x: c.at, y: r.y, w: Math.min(kerf, r.x + r.w - c.at), h: r.h } });
    } else {
      add({ stage: c.stage, direction: 'rip', x1: r.x, y1: c.at, x2: r.x + r.w, y2: c.at, kerf: { x: r.x, y: c.at, w: r.w, h: Math.min(kerf, r.y + r.h - c.at) } });
    }
  }
  const offcuts = out.offcuts.sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x);
  const partArea = out.placements.reduce((s, p) => s + p.w * p.h, 0);
  return { tree, placements: out.placements, offcuts, cuts, partArea };
}

interface Candidate {
  sheets: NestedSheet[];
  strategy: string;
  maxOffcut: number;
  cutCount: number;
}

const better = (a: Candidate, b: Candidate): boolean =>
  a.sheets.length !== b.sheets.length ? a.sheets.length < b.sheets.length : a.maxOffcut !== b.maxOffcut ? a.maxOffcut > b.maxOffcut : a.cutCount < b.cutCount;

/**
 * Nest items on identical sheets with guillotine cuts. Pure and deterministic.
 * `only` restricts the strategies tried (by name, e.g. /^strips/), for tests and diagnostics.
 */
export function nestGuillotine(items: readonly NestItem[], spec: NestSheetSpec, only?: RegExp): NestResult {
  const area = usableRect(spec);
  const unplaced: number[] = [];
  const ok: number[] = [];
  items.forEach((it, i) => {
    if (area && it.w > 0 && it.h > 0 && fitsSheet(it, area)) ok.push(i);
    else unplaced.push(i);
  });
  if (!area || ok.length === 0) return { sheets: [], unplaced, strategy: 'none' };

  const pick: { best: Candidate | null } = { best: null };
  const consider = (roots: MNode[], strategy: string) => {
    const sheets = roots.map((r) => describeSheet(freeze(r), spec));
    const cand: Candidate = {
      sheets,
      strategy,
      maxOffcut: Math.max(0, ...sheets.map((s) => (s.offcuts[0] ? s.offcuts[0].w * s.offcuts[0].h : 0))),
      cutCount: sheets.reduce((n, s) => n + s.cuts.length, 0),
    };
    if (!pick.best || better(cand, pick.best)) pick.best = cand;
  };
  const use = (name: string) => !only || only.test(name);
  for (const sort of SORTS) {
    const seq = order(items, ok, sort);
    for (const fit of FITS) {
      for (const split of SPLITS) {
        const name = `${sort}/${fit}/${split}`;
        if (use(name)) consider(pack(items, seq, area, spec.kerf, fit, split), name);
      }
    }
  }
  // Strips along the sheet, then across it (packed transposed and turned back).
  const flipped = items.map((it) => ({ w: it.h, h: it.w, canRotate: it.canRotate }));
  const flippedArea = { x: area.y, y: area.x, w: area.h, h: area.w };
  for (const sort of ['width', 'area'] as const) {
    if (use(`strips-along/${sort}`)) consider(packStrips(items, order(items, ok, sort), area, spec.kerf), `strips-along/${sort}`);
    if (use(`strips-across/${sort}`)) {
      const roots = packStrips(flipped, order(flipped, ok, sort), flippedArea, spec.kerf);
      roots.forEach(transposeNode);
      consider(roots, `strips-across/${sort}`);
    }
  }
  const best = pick.best;
  if (!best) return { sheets: [], unplaced: items.map((_, i) => i), strategy: 'none' };
  // Fullest sheets first.
  const sheets = [...best.sheets].sort((a, b) => b.partArea - a.partArea);
  return { sheets, unplaced, strategy: best.strategy };
}
