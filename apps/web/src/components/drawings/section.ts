/**
 * Side sections: vertical cuts through the run at x = const, looking toward +x (the left wall is
 * behind the viewer). World axes in a section: u = z out from the wall (wall on the left of the
 * page), v = y up.
 *
 * The run is cut once per distinct column: every stretch of x where the same carcasses, openings,
 * countertops and toe kick are cut gets a signature, and each signature is drawn once, at its
 * widest stretch, at a spot clear of sides, partitions and stiles.
 */
import type { BoxLayout, Id, Part, RunResult, Ticks } from '@cabinet-studio/engine';
import { chainPads, compactChains, type Chain, type ChainPoint } from './dimensions';
import { isFrame, isFront, roleClass } from './parts';
import { VIEW, type Pad, type ViewNeed } from './scale';

export interface SectionCut {
  /** Run-space x of the cutting plane. */
  x: Ticks;
  /** A, B, C… in x order. */
  label: string;
  /** Boxes the plane passes through, bottom → top. */
  boxIds: Id[];
}

/** Spreadsheet-style letters: A…Z, AA, AB… */
export function sectionLetter(i: number): string {
  const n = Math.floor(i / 26);
  return (n > 0 ? sectionLetter(n - 1) : '') + String.fromCharCode(65 + (i % 26));
}

const spans = (p: Part, x: Ticks) => p.bounds.x < x && x < p.bounds.x + p.bounds.width;
const inBox = (b: BoxLayout, x: Ticks) => b.carcass.x < x && x < b.carcass.x + b.carcass.width;
const yOverlap = (p: Part, b: BoxLayout) => p.bounds.y < b.carcass.y + b.carcass.height && b.carcass.y < p.bounds.y + p.bounds.height;

/** Toe kick front boards (the kick face), as opposed to the back board and cross pieces. */
export const isKickFront = (p: Part): boolean => roleClass(p.role) === 'kick' && p.bounds.z > 0 && p.bounds.width > p.bounds.depth;

/** Vertical members a cut should avoid: carcass sides, partitions, frame stiles, fillers, five-piece stiles. */
function isUpright(p: Part): boolean {
  if (p.role === 'side' || p.role === 'partition' || p.role === 'stile' || p.role === 'filler') return true;
  return p.role === 'frontFrame' && p.bounds.height > p.bounds.width;
}

/**
 * Where to cut within [a, b]: the middle of the widest stretch between part edges that no
 * upright covers (so not through a side, partition, stile or the gap between a pair of doors).
 */
export function cutPosition(result: RunResult, a: Ticks, b: Ticks): Ticks {
  const inside = result.parts.filter((p) => p.bounds.x < b && a < p.bounds.x + p.bounds.width);
  const xs = [...new Set([a, b, ...inside.flatMap((p) => [p.bounds.x, p.bounds.x + p.bounds.width]).filter((x) => x > a && x < b)])].sort((p, q) => p - q);
  const uprights = inside.filter(isUpright);
  let best: { a: Ticks; b: Ticks } | undefined;
  for (let i = 0; i + 1 < xs.length; i++) {
    const s = xs[i]!;
    const e = xs[i + 1]!;
    const mid = (s + e) / 2;
    if (uprights.some((p) => spans(p, mid))) continue;
    if (!best || e - s > best.b - best.a) best = { a: s, b: e };
  }
  const r = best ?? { a, b };
  return Math.round((r.a + r.b) / 2);
}

/** One section per distinct column of the run, in x order. */
export function sectionCuts(result: RunResult): SectionCut[] {
  const edges = new Set<Ticks>([0, result.width]);
  for (const b of result.boxes) {
    edges.add(b.carcass.x);
    edges.add(b.carcass.x + b.carcass.width);
    for (const s of b.sections) {
      if (s.kind !== 'opening') continue;
      edges.add(s.rect.x);
      edges.add(s.rect.x + s.rect.width);
    }
  }
  for (const g of result.gaps) {
    edges.add(g.rect.x);
    edges.add(g.rect.x + g.rect.width);
  }
  const xs = [...edges].sort((p, q) => p - q);

  const best = new Map<string, { a: Ticks; b: Ticks; boxIds: Id[] }>();
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]!;
    const b = xs[i + 1]!;
    if (b <= a) continue;
    const mid = (a + b) / 2;
    const boxes = result.boxes.filter((bx) => inBox(bx, mid)).sort((p, q) => p.carcass.y - q.carcass.y);
    if (boxes.length === 0) continue;
    const sig: string[] = [];
    let clear = true;
    for (const bx of boxes) {
      const c = bx.carcass;
      const ops = bx.sections.filter((s) => s.kind === 'opening');
      const here = ops.filter((s) => s.rect.x < mid && mid < s.rect.x + s.rect.width).sort((p, q) => p.rect.y - q.rect.y);
      if (ops.length > 0 && here.length === 0) clear = false; // through a side or stile, not an opening
      sig.push(`b${c.y},${c.height},${c.z},${c.depth}:${here.map((s) => `${s.front?.type ?? 'none'}@${s.rect.y},${s.rect.height}`).join(';')}`);
    }
    if (!clear) continue;
    for (const p of result.parts) {
      if (!spans(p, mid)) continue;
      if (p.role === 'countertop') sig.push(`c${p.bounds.y},${p.bounds.height},${p.bounds.z},${p.bounds.depth}`);
      else if (isKickFront(p)) sig.push(`k${p.bounds.z + p.bounds.depth}`);
    }
    const key = sig.join('|');
    const prev = best.get(key);
    if (!prev || b - a > prev.b - prev.a) best.set(key, { a, b, boxIds: boxes.map((bx) => bx.id) });
  }

  return [...best.values()]
    .map((r) => ({ x: cutPosition(result, r.a, r.b), boxIds: r.boxIds }))
    .sort((p, q) => p.x - q.x)
    .map((c, i) => ({ ...c, label: sectionLetter(i) }));
}

/** Everything a section view draws. */
export interface SectionData {
  cut: SectionCut;
  /** Parts the plane passes through. */
  parts: Part[];
  /** Uprights of the cut boxes just beyond the plane (seen in outline). */
  beyond: Part[];
  /** Boxes cut, bottom → top. */
  boxes: BoxLayout[];
  /** World window: u = z, v = y. */
  u0: Ticks;
  u1: Ticks;
  v0: Ticks;
  v1: Ticks;
}

/** Section through x = cut.x. Optionally only parts that pass `keep` (e.g. one box's parts). */
export function extractSection(result: RunResult, cut: SectionCut, keep?: (p: Part) => boolean): SectionData {
  const x = cut.x;
  const pool = keep ? result.parts.filter(keep) : result.parts;
  const parts = pool.filter((p) => spans(p, x));
  const boxes = result.boxes.filter((b) => inBox(b, x)).sort((p, q) => p.carcass.y - q.carcass.y);
  const beyond = pool.filter(
    (p) =>
      !spans(p, x) &&
      p.bounds.x >= x &&
      isUpright(p) &&
      p.role !== 'frontFrame' &&
      boxes.some((b) => p.bounds.x < b.carcass.x + b.carcass.width && yOverlap(p, b)),
  );
  const u1 = Math.max(0, ...boxes.map((b) => b.carcass.z + b.carcass.depth), ...[...parts, ...beyond].map((p) => p.bounds.z + p.bounds.depth));
  return { cut, parts, beyond, boxes, u0: 0, u1, v0: 0, v1: result.ceilingHeight };
}

/** Face of the face frame in front of a box (z), from the frame members at its height. */
export function frameFace(result: RunResult, data: SectionData, b: BoxLayout): Ticks | undefined {
  const pick = (ps: readonly Part[]) => ps.filter((p) => isFrame(p.role) && yOverlap(p, b) && p.bounds.z >= b.carcass.z + b.carcass.depth);
  let ps = pick(data.parts);
  if (ps.length === 0) ps = pick(result.parts.filter((p) => p.bounds.x < b.carcass.x + b.carcass.width && b.carcass.x < p.bounds.x + p.bounds.width));
  return ps.length ? Math.max(...ps.map((p) => p.bounds.z + p.bounds.depth)) : undefined;
}

/** Face of the fronts cut in front of a box (z), if any. */
export function frontFace(data: SectionData, b: BoxLayout): Ticks | undefined {
  const ps = data.parts.filter((p) => isFront(p.role) && yOverlap(p, b));
  return ps.length ? Math.max(...ps.map((p) => p.bounds.z + p.bounds.depth)) : undefined;
}

const pts = (ats: readonly (Ticks | undefined)[], from: Ticks): ChainPoint[] =>
  ats.filter((a): a is Ticks => a !== undefined).map((at) => ({ at, from }));

/**
 * Chains for a section.
 *  - Right: floor → each carcass bottom/top → countertop → ceiling; then the built-in's overall
 *    height; then the ceiling height.
 *  - Depths (wall → carcass → frame face → front face) per box: the lowest below the floor, the
 *    others above the ceiling (highest nearest).
 *  - Above, after the boxes: each countertop (to the frame face, then the overhang).
 *  - Below, after the lowest box: the toe kick setback (kick face → frame face).
 */
export function sectionChains(result: RunResult, data: SectionData): Chain[] {
  const H = result.ceilingHeight;
  const chains: Chain[] = [];
  const counters = data.parts.filter((p) => p.role === 'countertop').sort((a, b) => a.bounds.y - b.bounds.y);
  const kick = data.parts.find(isKickFront);
  const face = (b: BoxLayout) => frontFace(data, b) ?? frameFace(result, data, b) ?? b.carcass.z + b.carcass.depth;

  const vp: ChainPoint[] = [{ at: 0, from: data.u1 }, { at: H, from: data.u1 }];
  for (const b of data.boxes) vp.push({ at: b.carcass.y, from: face(b) }, { at: b.carcass.y + b.carcass.height, from: face(b) });
  for (const c of counters) vp.push({ at: c.bounds.y + c.bounds.height, from: c.bounds.z + c.bounds.depth });
  chains.push({ side: 'right', row: 0, points: vp });
  const top = Math.max(0, ...vp.filter((p) => p.at < H).map((p) => p.at));
  chains.push({ side: 'right', row: 1, points: pts([0, top], data.u1) });
  chains.push({ side: 'right', row: 2, points: pts([0, H], data.u1) });

  const depthPts = (b: BoxLayout, from: Ticks) => pts([0, b.carcass.z + b.carcass.depth, frameFace(result, data, b), frontFace(data, b)], from);
  const [lowest, ...higher] = data.boxes;
  if (lowest) chains.push({ side: 'bottom', row: 0, points: depthPts(lowest, lowest.carcass.y) });
  let row = 0;
  for (const b of [...higher].reverse()) chains.push({ side: 'top', row: row++, points: depthPts(b, b.carcass.y + b.carcass.height) });
  for (const c of [...counters].reverse()) {
    const under = data.boxes.find((b) => b.carcass.y + b.carcass.height === c.bounds.y);
    const ff = under ? frameFace(result, data, under) : undefined;
    chains.push({ side: 'top', row: row++, points: pts([0, ff, c.bounds.z + c.bounds.depth], c.bounds.y + c.bounds.height) });
  }
  if (kick && lowest) {
    const ff = frameFace(result, data, lowest) ?? lowest.carcass.z + lowest.carcass.depth;
    chains.push({ side: 'bottom', row: 1, points: pts([kick.bounds.z + kick.bounds.depth, ff], 0) });
  }
  return compactChains(chains);
}

/** Paper insets of a section view: wall poché on the left, floor and ceiling poché. */
export const SECTION_INSET: Partial<Pad> = { left: VIEW.poche, top: VIEW.poche, bottom: VIEW.poche };

/** A section's chains and the paper it needs (dimension stacks, poché, caption below). */
export function sectionLayout(result: RunResult, data: SectionData): { chains: Chain[]; need: ViewNeed } {
  const chains = sectionChains(result, data);
  const pad = chainPads(chains, SECTION_INSET);
  return { chains, need: { w: data.u1 - data.u0, h: data.v1 - data.v0, pad: { ...pad, right: pad.right + 4, bottom: pad.bottom + VIEW.caption } } };
}
