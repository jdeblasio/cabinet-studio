/**
 * Parts for drawings: how each role is drawn, box numbering, and grouping identical parts for
 * the per-box parts tables.
 */
import type { Id, Part, PartRole, Run, RunResult, Ticks } from '@built-in-planner/engine';

/** How a part is drawn. Unknown roles draw as carcass parts. */
export type RoleClass = 'carcass' | 'interior' | 'frame' | 'front' | 'panel' | 'countertop' | 'kick' | 'trim';

/** Keyed by string so roles newer than this table still type-check (and fall back). */
const ROLE_CLASS: Record<string, RoleClass> = {
  side: 'carcass',
  top: 'carcass',
  bottom: 'carcass',
  back: 'carcass',
  partition: 'carcass',
  fixedShelf: 'carcass',
  adjustableShelf: 'interior',
  drawerBox: 'interior',
  drawerBottom: 'interior',
  stile: 'frame',
  rail: 'frame',
  filler: 'frame',
  door: 'front',
  drawerFront: 'front',
  frontFrame: 'front',
  frontPanel: 'panel',
  countertop: 'countertop',
  toeKick: 'kick',
  molding: 'trim',
};

export function roleClass(role: string): RoleClass {
  return ROLE_CLASS[role] ?? 'carcass';
}

export const isFront = (role: string): boolean => {
  const c = roleClass(role);
  return c === 'front' || c === 'panel';
};
export const isFrame = (role: string): boolean => roleClass(role) === 'frame';

/** Painter's order for a front view: back to front by front face, fronts last on ties. */
export function frontToBack(parts: readonly Part[]): Part[] {
  return [...parts].sort(
    (a, b) => a.bounds.z + a.bounds.depth - (b.bounds.z + b.bounds.depth) || Number(isFront(a.role)) - Number(isFront(b.role)),
  );
}

export interface BoxLabel {
  id: Id;
  /** Sequential within the run: tier boxes bottom → top and left → right, then tall boxes. */
  num: number;
  /** The user's name, or "<tier> <n>" / "Tall box <n>". */
  name: string;
  /** Tier (or tier range for a tall box). */
  tierName: string;
}

/** Number and name every box in a run. */
export function boxLabels(run: Run, result: RunResult): Map<Id, BoxLabel> {
  const out = new Map<Id, BoxLabel>();
  let num = 0;
  for (const tl of result.tiers) {
    const tier = run.tiers.find((t) => t.id === tl.tierId);
    const tierName = tier?.name || 'Tier';
    const boxes = result.boxes.filter((b) => b.source === 'tier' && b.tierId === tl.tierId).sort((a, b) => a.carcass.x - b.carcass.x);
    boxes.forEach((b, i) => {
      const model = tier?.items.find((it) => it.kind === 'box' && it.id === b.id);
      const name = (model?.kind === 'box' ? model.name?.trim() : '') || `${tierName} ${i + 1}`;
      out.set(b.id, { id: b.id, num: ++num, name, tierName });
    });
  }
  const spans = result.boxes.filter((b) => b.source === 'span').sort((a, b) => a.carcass.x - b.carcass.x);
  spans.forEach((b, i) => {
    const span = run.spans.find((s) => s.id === b.id);
    const from = run.tiers.find((t) => t.id === span?.tiers.from)?.name;
    const to = run.tiers.find((t) => t.id === span?.tiers.to)?.name;
    const tierName = from && to && from !== to ? `${from}–${to}` : (from ?? 'Tall');
    out.set(b.id, { id: b.id, num: ++num, name: span?.name?.trim() || `Tall box ${i + 1}`, tierName });
  });
  return out;
}

/** A row of a parts table: identical parts (role, size, material) counted together. */
export interface PartGroup {
  key: string;
  name: string;
  role: PartRole;
  qty: number;
  length: Ticks;
  width: Ticks;
  thickness: Ticks;
  materialId: Id;
  partIds: Id[];
}

const ROLE_ORDER: readonly string[] = [
  'side',
  'partition',
  'top',
  'bottom',
  'fixedShelf',
  'adjustableShelf',
  'back',
  'stile',
  'rail',
  'filler',
  'door',
  'drawerFront',
  'frontFrame',
  'frontPanel',
  'drawerBox',
  'drawerBottom',
  'toeKick',
  'countertop',
  'molding',
];
const roleRank = (role: string) => {
  const i = ROLE_ORDER.indexOf(role);
  return i < 0 ? ROLE_ORDER.length : i;
};

const WORDS_DROPPED = new Set(['left', 'right', 'top', 'bottom', 'mid', 'front', 'back', 'upper', 'lower']);

/**
 * One name for parts grouped together: the shared name; else, when only qualifiers differ, the
 * shared trailing words ("Left side" + "Right side" → "Side") or the shared leading words with
 * the qualifiers ("Drawer box front" + "Drawer box back" → "Drawer box front/back"); else the
 * names joined.
 */
export function commonName(names: readonly string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? '';
  const split = unique.map((n) => n.trim().split(/\s+/));
  const lower = split.map((s) => s.map((w) => w.toLowerCase()));
  const head: string[] = [];
  for (let i = 0; split.every((s, j) => i < s.length - 1 && lower[j]![i] === lower[0]![i]); i++) head.push(split[0]![i]!);
  const rests = lower.map((s) => s.slice(head.length));
  if (head.length > 0 && rests.every((r) => r.length === 1 && WORDS_DROPPED.has(r[0]!))) {
    return `${head.join(' ')} ${rests.map((r) => r[0]).join('/')}`;
  }
  const tail: string[] = [];
  for (let i = 1; ; i++) {
    const w = split[0]![split[0]!.length - i];
    if (!w || !split.every((s) => s.length - i >= 0 && s[s.length - i]?.toLowerCase() === w.toLowerCase())) break;
    tail.unshift(w);
  }
  // Only a qualifier differs (e.g. Left/Right): use the shared tail.
  const heads = split.map((s) => s.slice(0, s.length - tail.length));
  if (tail.length > 0 && heads.every((h) => h.every((w) => WORDS_DROPPED.has(w.toLowerCase())))) {
    const name = tail.join(' ');
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return unique.join(' / ');
}

/** Group identical parts (role, length, width, thickness, material), in table order. */
export function groupParts(parts: readonly Part[]): PartGroup[] {
  const groups = new Map<string, { parts: Part[] }>();
  for (const p of parts) {
    const key = [p.role, p.length, p.width, p.thickness, p.materialId].join('|');
    const g = groups.get(key);
    if (g) g.parts.push(p);
    else groups.set(key, { parts: [p] });
  }
  const out: PartGroup[] = [];
  for (const [key, { parts: ps }] of groups) {
    const p = ps[0]!;
    out.push({
      key,
      name: commonName(ps.map((x) => x.name)),
      role: p.role,
      qty: ps.length,
      length: p.length,
      width: p.width,
      thickness: p.thickness,
      materialId: p.materialId,
      partIds: ps.map((x) => x.id),
    });
  }
  return out.sort((a, b) => roleRank(a.role) - roleRank(b.role) || b.length - a.length || b.width - a.width || a.name.localeCompare(b.name));
}

/** Parts a box owns (its carcass, rails, fronts, shelves and the stiles assigned to it). */
export function boxParts(result: RunResult, boxId: Id): Part[] {
  return result.parts.filter((p) => p.ownerId === boxId);
}
