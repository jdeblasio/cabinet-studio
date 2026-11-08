/**
 * Dimension chains: consecutive measurements along one axis, drawn on a row beside a view.
 *
 * Views build chains in world space (ticks): which features to measure, on which side, in which
 * row. `layoutChain` then works in paper space (points): dimension line, terminator ticks,
 * extension lines, and labels placed so text never collides. A label that fits sits centered
 * over its segment; one that doesn't goes past the end of the chain (first and last segments)
 * or to the other side of the line, pushed along so neighbors don't overlap, with a leader when
 * it had to move off its segment.
 */
import type { Ticks } from '@built-in-planner/engine';
import type { Pad } from './scale';

export type Side = 'top' | 'bottom' | 'left' | 'right';

/** A feature a chain measures to: its position along the chain axis, and where its extension line starts (the perpendicular coordinate). */
export interface ChainPoint {
  at: Ticks;
  from: Ticks;
}

/** A dimension chain in world space. Rows count outward from the view (0 = nearest). */
export interface Chain {
  side: Side;
  row: number;
  points: ChainPoint[];
}

/** Paper metrics for dimensions (points). */
export const DIM = {
  font: 6.5,
  /** Text height plus its gap from the dimension line: one label lane. */
  band: 8.5,
  /** View edge (plus any inset) to the first row's dimension line. */
  base: 12,
  /** Between rows: room for a lane on each side of a line. */
  rowGap: 17.5,
  /** Gap between a feature and its extension line. */
  extGap: 2,
  /** Extension line overshoot past the dimension line. */
  extOver: 2.5,
  /** Half-length of a terminator tick along each axis. */
  tick: 2,
  /** Clearance around label text. */
  pad: 1.8,
} as const;

/** Paper offset from a view edge to a row's dimension line. */
export const rowOffset = (row: number, inset = 0): number => inset + DIM.base + row * DIM.rowGap;

/** Paper space a side needs for `rows` rows of chains, beyond `inset`. */
export const stackSize = (rows: number, inset = 0): number => inset + (rows > 0 ? DIM.base + (rows - 1) * DIM.rowGap + DIM.band + 2 : 0);

/** Room past the ends of a horizontal chain for a tight end label, and past a vertical chain's ends for half a label. */
export const END_ROOM = { horizontal: 26, vertical: 12 } as const;

/**
 * Pads a view needs for its chains, plus any insets (e.g. wall poché) between the view and
 * its chains. Sides also keep room for labels that run past the ends of chains on the
 * neighboring sides.
 */
export function chainPads(chains: readonly Chain[], inset: Partial<Pad> = {}): Pad {
  const rows = (side: Side) => chains.filter((c) => c.side === side).reduce((m, c) => Math.max(m, c.row + 1), 0);
  const h = rows('top') + rows('bottom') > 0 ? END_ROOM.horizontal : 0;
  const v = rows('left') + rows('right') > 0 ? END_ROOM.vertical : 0;
  return {
    top: Math.max(stackSize(rows('top'), inset.top ?? 0), v),
    right: Math.max(stackSize(rows('right'), inset.right ?? 0), h),
    bottom: Math.max(stackSize(rows('bottom'), inset.bottom ?? 0), v),
    left: Math.max(stackSize(rows('left'), inset.left ?? 0), h),
  };
}

/** Number of distinct positions a chain measures (2 = a single dimension). */
export const chainSize = (c: Chain): number => new Set(c.points.map((p) => p.at)).size;

/** True if two chains measure exactly the same positions. */
export function sameChain(a: Chain, b: Chain): boolean {
  const pa = [...new Set(a.points.map((p) => p.at))].sort((x, y) => x - y);
  const pb = [...new Set(b.points.map((p) => p.at))].sort((x, y) => x - y);
  return pa.length === pb.length && pa.every((v, i) => v === pb[i]);
}

/** Drop chains that repeat an earlier chain on the same side, or measure nothing, and close up the rows. */
export function compactChains(chains: readonly Chain[]): Chain[] {
  const out: Chain[] = [];
  for (const c of [...chains].sort((a, b) => a.row - b.row)) {
    if (chainSize(c) < 2) continue;
    if (out.some((o) => o.side === c.side && sameChain(o, c))) continue;
    out.push({ ...c });
  }
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    out.filter((c) => c.side === side).forEach((c, i) => (c.row = i));
  }
  return out;
}

const CHAR_EM: Record<string, number> = { ' ': 0.28, '/': 0.32, '"': 0.36, "'": 0.2, '.': 0.28, ',': 0.28, '-': 0.34, '×': 0.58, '≈': 0.58, '(': 0.33, ')': 0.33 };

/** Estimated rendered width of text in a sans-serif face at `size`. */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) em += CHAR_EM[ch] ?? (/[0-9]/.test(ch) ? 0.56 : /[A-Z]/.test(ch) ? 0.64 : 0.52);
  return em * size;
}

export interface LabelPlacement {
  /** Center of the text along the chain axis. */
  pos: number;
  /** 0: the usual side of the line (above, or left for vertical chains); 1: the other side. */
  lane: 0 | 1;
  /** The label left its segment; draw a leader to the segment's middle. */
  moved: boolean;
}

/**
 * Place labels for consecutive segments [a, b] (paper, increasing) with text widths.
 * Labels that fit go centered in lane 0. With `ends`, a tight first or last segment puts its
 * label past the chain end in lane 0. Other tight labels go to lane 1, pushed along so none
 * overlap. Vertical chains pass `ends: false`: past their ends are the corners where the
 * horizontal chains' end labels go.
 */
export function placeLabels(segs: readonly { a: number; b: number; width: number }[], ends = true, pad: number = DIM.pad): LabelPlacement[] {
  const out: LabelPlacement[] = segs.map((s) => ({ pos: (s.a + s.b) / 2, lane: 0, moved: false }));
  const tight: number[] = [];
  const last = segs.length - 1;
  segs.forEach((s, i) => {
    if (s.width + 2 * pad <= s.b - s.a) return;
    if (ends && i === last) out[i] = { pos: s.b + DIM.tick + pad + s.width / 2, lane: 0, moved: false };
    else if (ends && i === 0) out[i] = { pos: s.a - DIM.tick - pad - s.width / 2, lane: 0, moved: false };
    else tight.push(i);
  });
  let edge = Number.NEGATIVE_INFINITY;
  for (const i of tight) {
    const s = segs[i]!;
    const want = (s.a + s.b) / 2;
    const pos = Math.max(want, edge + 2 * pad + s.width / 2);
    out[i] = { pos, lane: 1, moved: pos - want > (s.b - s.a) / 2 + 0.5 };
    edge = pos + s.width / 2;
  }
  return out;
}

/** A chain point in paper space; `value` is its world position (for labels). */
export interface PaperPoint {
  pos: number;
  from: number;
  value: Ticks;
}

export interface ChainLabel extends LabelPlacement {
  text: string;
  width: number;
  /** Segment middle, for the leader of a moved label. */
  mid: number;
}

export interface ChainLayout {
  side: Side;
  /** Position of the dimension line across the chain axis. */
  line: number;
  /** Dimension line extent along the axis. */
  start: number;
  end: number;
  ticks: number[];
  /** Extension lines: at `pos` along the axis, from → to across it. */
  ext: { pos: number; from: number; to: number }[];
  labels: ChainLabel[];
}

/**
 * Lay out a chain in paper space. Points at the same world position merge (keeping the
 * extension line that starts nearest the dimension line); each segment is labeled with
 * `fmt(length)`.
 */
export function layoutChain(points: readonly PaperPoint[], side: Side, line: number, fmt: (t: Ticks) => string, font: number = DIM.font): ChainLayout | null {
  const merged: PaperPoint[] = [];
  for (const p of [...points].sort((a, b) => a.pos - b.pos || a.value - b.value)) {
    const prev = merged[merged.length - 1];
    if (prev && (prev.value === p.value || Math.abs(prev.pos - p.pos) < 1e-6)) {
      if (Math.abs(line - p.from) < Math.abs(line - prev.from)) prev.from = p.from;
      continue;
    }
    merged.push({ ...p });
  }
  if (merged.length < 2) return null;

  const segs = merged.slice(1).map((b, i) => {
    const a = merged[i]!;
    const text = fmt(Math.abs(b.value - a.value));
    return { a: a.pos, b: b.pos, text, width: textWidth(text, font) };
  });
  const placed = placeLabels(segs, side === 'top' || side === 'bottom');
  const ext: ChainLayout['ext'] = [];
  for (const p of merged) {
    const dir = Math.sign(line - p.from);
    if (dir === 0 || Math.abs(line - p.from) < DIM.extGap + 1) continue;
    ext.push({ pos: p.pos, from: p.from + dir * DIM.extGap, to: line + dir * DIM.extOver });
  }
  return {
    side,
    line,
    start: merged[0]!.pos,
    end: merged[merged.length - 1]!.pos,
    ticks: merged.map((p) => p.pos),
    ext,
    labels: segs.map((s, i) => ({ ...placed[i]!, text: s.text, width: s.width, mid: (s.a + s.b) / 2 })),
  };
}
