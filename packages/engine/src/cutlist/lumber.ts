/**
 * 1D lumber optimization: lumber parts grouped by (material, thickness, rip width), their lengths
 * packed into stock boards with kerf and end trim. Parts wider than the widest board become
 * glue-ups: several boards (strips) cut to length and edge-glued.
 *
 * Rows bought by length (moldings) are not packed; the shopping list gives their total length.
 *
 * Heuristic: several candidate packings are built and the one buying the least total board
 * length wins (then the fewest boards, then the longest single offcut):
 *  - first fit / best fit decreasing on the longest stock, each board then shortened to the
 *    shortest stock length that still holds its pieces;
 *  - the same on each single stock length;
 *  - a sequential fill: each new board takes the stock length and the subset of the remaining
 *    pieces (bounded exhaustive search) that waste the smallest share of the board.
 */
import type { Id, Material } from '../model';
import type { Ticks } from '../units';
import { glueUpPlan, type CutListGroup } from './cutlist';
import type { LumberOptions } from './options';
import { boardFeet, type PartRef } from './parts';

export interface LumberPiece {
  part: PartRef;
  /** Cut list row label. */
  label: string;
  /** Length to cut (the part length, or the glue-up strip length). */
  length: Ticks;
  /** Glue-up strips: which strip (1-based) of how many. */
  strip?: { index: number; of: number };
}

export interface BoardCut {
  piece: LumberPiece;
  /** From the board's start end. */
  offset: Ticks;
}

export interface LumberBoard {
  stockLength: Ticks;
  cuts: BoardCut[];
  /** Total length of the pieces. */
  used: Ticks;
  /** stockLength − used (trim, kerf and offcut). */
  waste: Ticks;
  /** Usable piece left at the far end, after the last kerf and before the end trim. */
  offcut: Ticks;
}

export interface GlueUp {
  label: string;
  parts: PartRef[];
  length: Ticks;
  width: Ticks;
  thickness: Ticks;
  boards: number;
  boardWidth: Ticks;
  boardLength: Ticks;
}

export interface LumberPlan {
  /** `${materialId}|${thickness}|${width}` */
  key: string;
  materialId: Id;
  materialName: string;
  thickness: Ticks;
  /** Rip width of every piece in this plan. */
  width: Ticks;
  boards: LumberBoard[];
  /** Pieces longer than every stock board. Never dropped silently. */
  tooLong: LumberPiece[];
  /** Boards to buy per stock length, shortest first. */
  stock: { length: Ticks; count: number }[];
  /** Board feet of the stock boards at this thickness and rip width. */
  boardFeet: number;
  pieces: number;
  /** Piece length / stock length bought. */
  utilization: number;
}

export interface LumberResult {
  plans: LumberPlan[];
  glueUps: GlueUp[];
}

interface Packed {
  boards: { stock: Ticks; items: number[] }[];
  total: Ticks;
  maxOffcut: Ticks;
}

/** Usable length of a stock board. */
const capOf = (stock: Ticks, o: Pick<LumberOptions, 'endTrim'>) => stock - 2 * o.endTrim;
/** Length a set of pieces takes on a board: pieces plus the kerfs between them. */
const span = (lens: readonly Ticks[], kerf: Ticks) => (lens.length ? lens.reduce((s, l) => s + l, 0) + (lens.length - 1) * kerf : 0);

function finish(boards: { stock: Ticks; items: number[] }[], lengths: readonly Ticks[], stock: readonly Ticks[], o: Pick<LumberOptions, 'kerf' | 'endTrim'>, shrink: boolean): Packed {
  let total = 0;
  let maxOffcut = 0;
  for (const b of boards) {
    const used = span(b.items.map((i) => lengths[i]!), o.kerf);
    if (shrink) b.stock = stock.find((s) => capOf(s, o) >= used) ?? b.stock;
    total += b.stock;
    maxOffcut = Math.max(maxOffcut, capOf(b.stock, o) - used - o.kerf);
  }
  return { boards, total, maxOffcut };
}

/** First fit (or best fit) decreasing onto boards of one stock length. */
function fitDecreasing(order: readonly number[], lengths: readonly Ticks[], board: Ticks, o: Pick<LumberOptions, 'kerf' | 'endTrim'>, bestFit: boolean) {
  const cap = capOf(board, o);
  const boards: { stock: Ticks; items: number[]; left: Ticks }[] = [];
  for (const i of order) {
    const need = lengths[i]!;
    let pick = -1;
    for (let b = 0; b < boards.length; b++) {
      const left = boards[b]!.left - o.kerf;
      if (need <= left && (pick < 0 || (bestFit && left < boards[pick]!.left - o.kerf))) {
        pick = b;
        if (!bestFit) break;
      }
    }
    if (pick < 0) {
      boards.push({ stock: board, items: [i], left: cap - need });
    } else {
      const b = boards[pick]!;
      b.items.push(i);
      b.left -= need + o.kerf;
    }
  }
  return boards.map(({ stock, items }) => ({ stock, items }));
}

/**
 * Best subset of `remaining` pieces for one board of usable length `cap`: maximizes the length
 * used. Bounded depth-first search over distinct lengths (identical pieces are interchangeable).
 */
function bestFill(remaining: readonly number[], lengths: readonly Ticks[], cap: Ticks, kerf: Ticks, budget = 4000): number[] {
  // Distinct lengths, longest first, with the pieces of each.
  const byLen = new Map<Ticks, number[]>();
  for (const i of remaining) {
    const l = lengths[i]!;
    const list = byLen.get(l);
    if (list) list.push(i);
    else byLen.set(l, [i]);
  }
  const groups = [...byLen.entries()].sort((a, b) => b[0] - a[0]);
  const weight = groups.map(([l]) => l + kerf); // each piece costs its length plus one kerf
  const C = cap + kerf;
  const suffix: number[] = new Array(groups.length + 1).fill(0);
  for (let g = groups.length - 1; g >= 0; g--) suffix[g] = suffix[g + 1]! + weight[g]! * groups[g]![1].length;

  let best: number[] = groups.map(() => 0);
  let bestSum = -1;
  const take = groups.map(() => 0);
  let nodes = 0;
  const dfs = (g: number, sum: number): void => {
    if (++nodes > budget) return;
    if (sum > bestSum) {
      bestSum = sum;
      best = [...take];
    }
    if (g >= groups.length || bestSum === C || sum + suffix[g]! <= bestSum) return;
    const w = weight[g]!;
    const max = Math.min(groups[g]![1].length, Math.floor((C - sum) / w));
    for (let k = max; k >= 0; k--) {
      take[g] = k;
      dfs(g + 1, sum + k * w);
      if (nodes > budget) break;
    }
    take[g] = 0;
  };
  dfs(0, 0);
  const out: number[] = [];
  groups.forEach(([, idx], g) => out.push(...idx.slice(0, best[g])));
  return out;
}

/** Sequential fill: each board gets the stock length and subset with the smallest waste share. */
function sequential(order: readonly number[], lengths: readonly Ticks[], stock: readonly Ticks[], o: Pick<LumberOptions, 'kerf' | 'endTrim'>) {
  let remaining = [...order];
  const boards: { stock: Ticks; items: number[] }[] = [];
  while (remaining.length) {
    let pick: { stock: Ticks; items: number[]; ratio: number } | null = null;
    for (const s of stock) {
      const items = bestFill(remaining, lengths, capOf(s, o), o.kerf);
      if (!items.length) continue;
      const used = items.reduce((n, i) => n + lengths[i]!, 0);
      const ratio = (s - used) / s;
      if (!pick || ratio < pick.ratio - 1e-12 || (Math.abs(ratio - pick.ratio) <= 1e-12 && s > pick.stock)) pick = { stock: s, items, ratio };
    }
    if (!pick) break; // cannot happen: every piece fits the longest stock
    const taken = new Set(pick.items);
    remaining = remaining.filter((i) => !taken.has(i));
    boards.push({ stock: pick.stock, items: [...pick.items].sort((a, b) => lengths[b]! - lengths[a]! || a - b) });
  }
  return boards;
}

/**
 * Pack piece lengths into stock boards. Returns boards (piece indices, longest first) and
 * the indices of pieces too long for any board. Pure and deterministic.
 */
export function packLengths(lengths: readonly Ticks[], options: Pick<LumberOptions, 'kerf' | 'endTrim' | 'stockLengths'>): { boards: { stock: Ticks; items: number[] }[]; tooLong: number[] } {
  const stock = [...new Set(options.stockLengths)].filter((s) => capOf(s, options) > 0).sort((a, b) => a - b);
  const longest = stock[stock.length - 1];
  const tooLong: number[] = [];
  const ok: number[] = [];
  lengths.forEach((l, i) => (longest !== undefined && l > 0 && l <= capOf(longest, options) ? ok : tooLong).push(i));
  if (!ok.length || longest === undefined) return { boards: [], tooLong };

  const order = [...ok].sort((a, b) => lengths[b]! - lengths[a]! || a - b);
  const candidates: Packed[] = [];
  candidates.push(finish(fitDecreasing(order, lengths, longest, options, false), lengths, stock, options, true));
  candidates.push(finish(fitDecreasing(order, lengths, longest, options, true), lengths, stock, options, true));
  for (const s of stock) {
    if (s === longest || capOf(s, options) < lengths[order[0]!]!) continue;
    candidates.push(finish(fitDecreasing(order, lengths, s, options, true), lengths, stock, options, true));
  }
  candidates.push(finish(sequential(order, lengths, stock, options), lengths, stock, options, false));

  let best = candidates[0]!;
  for (const c of candidates.slice(1)) {
    if (c.total < best.total || (c.total === best.total && (c.boards.length < best.boards.length || (c.boards.length === best.boards.length && c.maxOffcut > best.maxOffcut)))) best = c;
  }
  // Longest boards first, then fullest.
  const boards = best.boards
    .map((b) => ({ stock: b.stock, items: [...b.items].sort((p, q) => lengths[q]! - lengths[p]! || p - q) }))
    .sort((a, b) => b.stock - a.stock || span(b.items.map((i) => lengths[i]!), 0) - span(a.items.map((i) => lengths[i]!), 0) || a.items[0]! - b.items[0]!);
  return { boards, tooLong };
}

/** Lumber pieces of one cut list group: part lengths, and glue-up strips for wide parts. */
function piecesOf(group: CutListGroup, opts: LumberOptions, grid: Ticks): { byWidth: Map<string, { thickness: Ticks; width: Ticks; pieces: LumberPiece[] }>; glueUps: GlueUp[] } {
  const byWidth = new Map<string, { thickness: Ticks; width: Ticks; pieces: LumberPiece[] }>();
  const glueUps: GlueUp[] = [];
  const add = (thickness: Ticks, width: Ticks, piece: LumberPiece) => {
    const k = `${thickness}|${width}`;
    let g = byWidth.get(k);
    if (!g) byWidth.set(k, (g = { thickness, width, pieces: [] }));
    g.pieces.push(piece);
  };
  for (const row of group.rows) {
    if (row.byLength) continue; // moldings are bought by length
    const plan = glueUpPlan(row.width, row.length, opts, grid);
    if (plan) {
      glueUps.push({ label: row.label, parts: row.parts, length: row.length, width: row.width, thickness: row.thickness, ...plan });
      for (const p of row.parts) {
        for (let s = 0; s < plan.boards; s++) add(row.thickness, plan.boardWidth, { part: p, label: row.label, length: plan.boardLength, strip: { index: s + 1, of: plan.boards } });
      }
    } else {
      for (const p of row.parts) add(row.thickness, row.width, { part: p, label: row.label, length: row.length });
    }
  }
  return { byWidth, glueUps };
}

/** Plan stock boards for every lumber material's cut list group. */
export function planLumber(groups: readonly CutListGroup[], materials: readonly Material[], opts: LumberOptions, grid: Ticks): LumberResult {
  const plans: LumberPlan[] = [];
  const glueUps: GlueUp[] = [];
  for (const group of groups) {
    const material = materials.find((m) => m.id === group.materialId);
    const { byWidth, glueUps: gu } = piecesOf(group, opts, grid);
    glueUps.push(...gu);
    const entries = [...byWidth.values()].sort((a, b) => b.thickness - a.thickness || b.width - a.width);
    for (const { thickness, width, pieces } of entries) {
      const lengths = pieces.map((p) => p.length);
      const packed = packLengths(lengths, opts);
      const boards: LumberBoard[] = packed.boards.map((b) => {
        let at = opts.endTrim;
        const cuts: BoardCut[] = b.items.map((i, n) => {
          const offset = at + (n > 0 ? opts.kerf : 0);
          at = offset + lengths[i]!;
          return { piece: pieces[i]!, offset };
        });
        const used = b.items.reduce((s, i) => s + lengths[i]!, 0);
        return { stockLength: b.stock, cuts, used, waste: b.stock - used, offcut: Math.max(0, b.stock - opts.endTrim - at - opts.kerf) };
      });
      const counts = new Map<Ticks, number>();
      for (const b of boards) counts.set(b.stockLength, (counts.get(b.stockLength) ?? 0) + 1);
      const stock = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([length, count]) => ({ length, count }));
      const bought = boards.reduce((s, b) => s + b.stockLength, 0);
      const used = boards.reduce((s, b) => s + b.used, 0);
      plans.push({
        key: `${group.materialId}|${thickness}|${width}`,
        materialId: group.materialId,
        materialName: material?.name ?? group.name,
        thickness,
        width,
        boards,
        tooLong: packed.tooLong.map((i) => pieces[i]!),
        stock,
        boardFeet: boards.reduce((s, b) => s + boardFeet(thickness, width, b.stockLength), 0),
        pieces: pieces.length,
        utilization: bought > 0 ? used / bought : 0,
      });
    }
  }
  return { plans, glueUps };
}
