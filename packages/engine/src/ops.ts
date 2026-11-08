/**
 * Model edit operations: pure helpers that mutate a design-model draft in place
 * (designed for immer drafts, but work on any mutable object).
 *
 * Lookups throw on missing ids only where noted; mutating ops on unknown ids are no-ops
 * that return false/undefined so the editor can call them speculatively.
 */
import type { RunResult } from './derived';
import { createDefaultRun, hardwareOf, newId } from './defaults';
import { deriveRun } from './derive/index';
import type {
  Box,
  EndCondition,
  Front,
  HardwareLibrary,
  Id,
  Material,
  Molding,
  NamedStyle,
  Opening,
  Project,
  Run,
  Section,
  SettingsScope,
  SizeSpec,
  Span,
  Split,
  Tier,
} from './model';
import { resolveSettings } from './settings';
import { inches, snap, type Ticks } from './units';

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findRun(project: Project, runId: Id): Run | undefined {
  return project.runs.find((r) => r.id === runId);
}

export function findTier(run: Run, tierId: Id): Tier | undefined {
  return run.tiers.find((t) => t.id === tierId);
}

export function findBox(run: Run, boxId: Id): { tier: Tier; index: number; box: Box } | undefined {
  for (const tier of run.tiers) {
    const index = tier.items.findIndex((it) => it.kind === 'box' && it.id === boxId);
    if (index >= 0) return { tier, index, box: tier.items[index] as Box };
  }
  return undefined;
}

export function findSpan(run: Run, spanId: Id): Span | undefined {
  return run.spans.find((s) => s.id === spanId);
}

/** A box or span: anything that owns a section tree. */
export type SectionOwner = Box | Span;

export function findOwner(run: Run, ownerId: Id): SectionOwner | undefined {
  return findBox(run, ownerId)?.box ?? findSpan(run, ownerId);
}

export interface SectionHit {
  section: Section;
  /** Parent split, if the section is not the owner's root. */
  parent?: Split;
  /** Index within the parent's children (0 for the root). */
  index: number;
}

export function findSection(root: Section, sectionId: Id, parent?: Split, index = 0): SectionHit | undefined {
  if (root.id === sectionId) return { section: root, parent, index };
  if (root.kind === 'split') {
    for (let i = 0; i < root.children.length; i++) {
      const hit = findSection(root.children[i]!.section, sectionId, root, i);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function findSectionInRun(run: Run, sectionId: Id): (SectionHit & { owner: SectionOwner }) | undefined {
  const owners: SectionOwner[] = [
    ...run.tiers.flatMap((t) => t.items.filter((it): it is Box => it.kind === 'box')),
    ...run.spans,
  ];
  for (const owner of owners) {
    const hit = findSection(owner.content, sectionId);
    if (hit) return { ...hit, owner };
  }
  return undefined;
}

/** Ids of the chain from the owner's root down to `sectionId` (inclusive), or [] if not found. */
export function sectionPath(root: Section, sectionId: Id): Id[] {
  if (root.id === sectionId) return [root.id];
  if (root.kind === 'split') {
    for (const c of root.children) {
      const p = sectionPath(c.section, sectionId);
      if (p.length) return [root.id, ...p];
    }
  }
  return [];
}

function firstOpening(section: Section): Opening | undefined {
  if (section.kind === 'opening') return section;
  for (const c of section.children) {
    const o = firstOpening(c.section);
    if (o) return o;
  }
  return undefined;
}

function replaceSection(owner: SectionOwner, hit: SectionHit, next: Section): void {
  if (hit.parent) hit.parent.children[hit.index]!.section = next;
  else owner.content = next;
}

/** Deep copy of a section tree with fresh ids. */
export function cloneSection(section: Section): Section {
  if (section.kind === 'opening') return { ...section, id: newId(), front: { ...section.front } };
  return {
    ...section,
    id: newId(),
    children: section.children.map((c) => ({ size: { ...c.size }, section: cloneSection(c.section) })),
  };
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function newOpening(front: Front = { type: 'none' }, adjustableShelves = 0): Opening {
  return { kind: 'opening', id: newId(), front, adjustableShelves };
}

export function newBox(content: Section = newOpening(), width: SizeSpec = { kind: 'flex', ratio: 1 }): Box {
  return { kind: 'box', id: newId(), width, content };
}

export function newTier(depth: Ticks, name = 'Tier'): Tier {
  return {
    id: newId(),
    name,
    kind: 'boxes',
    height: { kind: 'flex', ratio: 1 },
    depth,
    items: [newBox()],
  };
}

// ---------------------------------------------------------------------------
// Tier items (boxes)
// ---------------------------------------------------------------------------

const itemKey = (it: Tier['items'][number]): Id => (it.kind === 'box' ? it.id : it.spanId);

/**
 * Insert a box next to `refItemId` (a box id or a span id whose slot is in this tier),
 * or at the end if `refItemId` is null. When no box is given, the new box copies the
 * reference box's width spec and face layout (with fresh ids). Returns the new box id.
 */
export function addBox(
  run: Run,
  tierId: Id,
  refItemId: Id | null,
  side: 'left' | 'right' = 'right',
  box?: Box,
): Id | undefined {
  const tier = findTier(run, tierId);
  if (!tier) return undefined;
  const refIndex = refItemId === null ? -1 : tier.items.findIndex((it) => itemKey(it) === refItemId);
  const ref = refIndex >= 0 ? tier.items[refIndex] : undefined;
  const nb =
    box ??
    (ref?.kind === 'box'
      ? newBox(cloneSection(ref.content), ref.width.kind === 'flex' ? { ...ref.width } : { kind: 'flex', ratio: 1 })
      : newBox());
  const at = refIndex < 0 ? tier.items.length : side === 'left' ? refIndex : refIndex + 1;
  tier.items.splice(at, 0, nb);
  return nb.id;
}

export function removeBox(run: Run, boxId: Id): boolean {
  const hit = findBox(run, boxId);
  if (!hit) return false;
  hit.tier.items.splice(hit.index, 1);
  return true;
}

export function setBoxWidth(run: Run, boxId: Id, spec: SizeSpec): boolean {
  const hit = findBox(run, boxId);
  if (!hit) return false;
  hit.box.width = spec;
  return true;
}

export function setBoxName(run: Run, boxId: Id, name: string): boolean {
  const owner = findOwner(run, boxId);
  if (!owner) return false;
  owner.name = name || undefined;
  return true;
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/** Add a tier above/below `refTierId` (or at the top if null). Returns the new tier id. */
export function addTier(run: Run, refTierId: Id | null, side: 'above' | 'below' = 'above', tier?: Tier): Id {
  const refIndex = refTierId === null ? -1 : run.tiers.findIndex((t) => t.id === refTierId);
  const ref = refIndex >= 0 ? run.tiers[refIndex] : run.tiers[run.tiers.length - 1];
  const t = tier ?? newTier(ref?.depth ?? inches(12), `Tier ${run.tiers.length + 1}`);
  const at = refIndex < 0 ? run.tiers.length : side === 'above' ? refIndex + 1 : refIndex;
  run.tiers.splice(at, 0, t);
  // A toe kick is only meaningful on the bottom tier; move it if the new tier became the bottom.
  if (at === 0 && run.tiers[1]?.toeKick && !t.toeKick) {
    t.toeKick = run.tiers[1].toeKick;
    delete run.tiers[1].toeKick;
  }
  return t.id;
}

/** Remove a tier; spans that reference it shrink their range, and spans left with no tiers are removed. */
export function removeTier(run: Run, tierId: Id): boolean {
  const index = run.tiers.findIndex((t) => t.id === tierId);
  if (index < 0) return false;
  for (const span of [...run.spans]) {
    const from = run.tiers.findIndex((t) => t.id === span.tiers.from);
    const to = run.tiers.findIndex((t) => t.id === span.tiers.to);
    if (index < from || index > to) continue;
    if (from === to) {
      removeSpan(run, span.id);
      continue;
    }
    if (index === from) span.tiers.from = run.tiers[from + 1]!.id;
    if (index === to) span.tiers.to = run.tiers[to - 1]!.id;
  }
  const [removed] = run.tiers.splice(index, 1);
  if (index === 0 && removed?.toeKick && run.tiers[0] && !run.tiers[0].toeKick) run.tiers[0].toeKick = removed.toeKick;
  return true;
}

export function setTierHeight(run: Run, tierId: Id, spec: SizeSpec): boolean {
  const tier = findTier(run, tierId);
  if (!tier) return false;
  tier.height = spec;
  return true;
}

export function setTierDepth(run: Run, tierId: Id, depth: Ticks): boolean {
  const tier = findTier(run, tierId);
  if (!tier) return false;
  tier.depth = depth;
  return true;
}

export function setTierKind(run: Run, tierId: Id, kind: Tier['kind']): boolean {
  const tier = findTier(run, tierId);
  if (!tier) return false;
  tier.kind = kind;
  if (kind === 'boxes' && !tier.items.some((it) => it.kind === 'box')) tier.items.push(newBox());
  return true;
}

export function setTierName(run: Run, tierId: Id, name: string): boolean {
  const tier = findTier(run, tierId);
  if (!tier) return false;
  tier.name = name;
  return true;
}

export function setToeKick(run: Run, tierId: Id, toeKick: Tier['toeKick'] | undefined): boolean {
  const tier = findTier(run, tierId);
  if (!tier) return false;
  if (toeKick) tier.toeKick = toeKick;
  else delete tier.toeKick;
  return true;
}

export function setCountertop(run: Run, tierId: Id, countertop: Tier['countertop'] | undefined): boolean {
  const tier = findTier(run, tierId);
  if (!tier) return false;
  if (countertop) tier.countertop = countertop;
  else delete tier.countertop;
  return true;
}

// ---------------------------------------------------------------------------
// Sections (face layout)
// ---------------------------------------------------------------------------

/**
 * Split an opening into `n` children of flex 1. The first child keeps the original
 * opening (id, front, shelves); the others copy its front and shelf count.
 * Returns the new split's id.
 */
export function splitOpening(
  run: Run,
  openingId: Id,
  direction: Split['direction'],
  n = 2,
  divider: Split['divider'] = 'panel',
): Id | undefined {
  const hit = findSectionInRun(run, openingId);
  if (!hit || hit.section.kind !== 'opening' || n < 2) return undefined;
  const original = hit.section;
  const children = [original, ...Array.from({ length: n - 1 }, () => newOpening({ ...original.front }, original.adjustableShelves))];
  const split: Split = {
    kind: 'split',
    id: newId(),
    direction,
    divider,
    children: children.map((section) => ({ size: { kind: 'flex', ratio: 1 }, section })),
  };
  replaceSection(hit.owner, hit, split);
  return split.id;
}

/** Replace a split with its first descendant opening. Returns that opening's id. */
export function unsplit(run: Run, splitId: Id): Id | undefined {
  const hit = findSectionInRun(run, splitId);
  if (!hit || hit.section.kind !== 'split') return undefined;
  const keep = firstOpening(hit.section) ?? newOpening();
  replaceSection(hit.owner, hit, keep);
  return keep.id;
}

/** Add a child (an empty-front opening, flex 1) to a split at `index` (default: end). */
export function addSplitChild(run: Run, splitId: Id, index?: number): Id | undefined {
  const hit = findSectionInRun(run, splitId);
  if (!hit || hit.section.kind !== 'split') return undefined;
  const sibling = firstOpening(hit.section);
  const o = newOpening(sibling ? { ...sibling.front } : { type: 'none' }, sibling?.adjustableShelves ?? 0);
  const at = index ?? hit.section.children.length;
  hit.section.children.splice(at, 0, { size: { kind: 'flex', ratio: 1 }, section: o });
  return o.id;
}

/** Remove the child of a split that contains `sectionId`; collapses the split if one child remains. */
export function removeSection(run: Run, sectionId: Id): boolean {
  const hit = findSectionInRun(run, sectionId);
  if (!hit?.parent) return false;
  const parent = hit.parent;
  parent.children.splice(hit.index, 1);
  if (parent.children.length === 1) {
    const parentHit = findSectionInRun(run, parent.id);
    if (parentHit) replaceSection(parentHit.owner, parentHit, parent.children[0]!.section);
  }
  return true;
}

export function setSplitChildSize(run: Run, splitId: Id, index: number, spec: SizeSpec): boolean {
  const hit = findSectionInRun(run, splitId);
  if (!hit || hit.section.kind !== 'split' || !hit.section.children[index]) return false;
  hit.section.children[index]!.size = spec;
  return true;
}

export function setSplitDivider(run: Run, splitId: Id, divider: Split['divider']): boolean {
  const hit = findSectionInRun(run, splitId);
  if (!hit || hit.section.kind !== 'split') return false;
  hit.section.divider = divider;
  return true;
}

export function setFront(run: Run, openingId: Id, front: Front): boolean {
  const hit = findSectionInRun(run, openingId);
  if (!hit || hit.section.kind !== 'opening') return false;
  hit.section.front = front;
  return true;
}

export function setAdjustableShelves(run: Run, openingId: Id, count: number): boolean {
  const hit = findSectionInRun(run, openingId);
  if (!hit || hit.section.kind !== 'opening') return false;
  hit.section.adjustableShelves = Math.max(0, Math.round(count));
  return true;
}

/** Set an opening's fixed shelf count (0 removes them). */
export function setFixedShelves(run: Run, openingId: Id, count: number): boolean {
  const hit = findSectionInRun(run, openingId);
  if (!hit || hit.section.kind !== 'opening') return false;
  const n = Math.max(0, Math.round(count));
  if (n > 0) hit.section.fixedShelves = n;
  else delete hit.section.fixedShelves;
  return true;
}

// ---------------------------------------------------------------------------
// Spans (tall boxes, gaps)
// ---------------------------------------------------------------------------

export interface NewSpan {
  kind: Span['kind'];
  fromTierId: Id;
  toTierId: Id;
  width: Ticks;
  x?: Span['x'];
  depth?: Ticks;
  name?: string;
  content?: Section;
}

/** Tier ids from `fromId` to `toId` inclusive (bottom → top), or [] if invalid. */
export function tierRange(run: Run, fromId: Id, toId: Id): Id[] {
  const a = run.tiers.findIndex((t) => t.id === fromId);
  const b = run.tiers.findIndex((t) => t.id === toId);
  if (a < 0 || b < 0) return [];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return run.tiers.slice(lo, hi + 1).map((t) => t.id);
}

/** Absolute x (left edge) of a span in run space, from its anchor and the run's minimum scribes. */
export function spanAbsoluteX(project: Project, run: Run, span: Pick<Span, 'x' | 'width'>): Ticks {
  const settings = resolveSettings(project, [run]);
  const width = run.wall[0]?.length ?? 0;
  const zl = run.ends.left === 'wall' ? settings.faceFrame.scribeAllowance : 0;
  const zr = width - (run.ends.right === 'wall' ? settings.faceFrame.scribeAllowance : 0);
  switch (span.x.anchor) {
    case 'left':
      return zl + span.x.offset;
    case 'right':
      return zr - span.x.offset - span.width;
    case 'center':
      return (zl + zr) / 2 + span.x.offset - span.width / 2;
  }
}

function safeDerive(project: Project, runId: Id): RunResult | undefined {
  try {
    return deriveRun(project, runId);
  } catch {
    return undefined;
  }
}

/**
 * (Re)insert the span's slot markers into every 'boxes' tier it spans, at the index matching
 * its x position (using the current derived layout when available, otherwise an even-split
 * estimate). Slots in tiers outside the span's range are removed.
 */
export function placeSpanSlots(project: Project, runId: Id, spanId: Id, layout?: RunResult): boolean {
  const run = findRun(project, runId);
  const span = run && findSpan(run, spanId);
  if (!run || !span) return false;
  const result = layout ?? safeDerive(project, runId);
  const inRange = new Set(tierRange(run, span.tiers.from, span.tiers.to));
  const cx = spanAbsoluteX(project, run, span) + span.width / 2;
  const settings = resolveSettings(project, [run]);
  const runWidth = run.wall[0]?.length ?? 0;
  const zl = run.ends.left === 'wall' ? settings.faceFrame.scribeAllowance : 0;
  const zr = runWidth - (run.ends.right === 'wall' ? settings.faceFrame.scribeAllowance : 0);

  const left = spanAbsoluteX(project, run, span);
  const right = left + span.width;
  const tol = project.units.grid;

  for (const tier of run.tiers) {
    tier.items = tier.items.filter((it) => !(it.kind === 'slot' && it.spanId === spanId));
    if (!inRange.has(tier.id) || tier.kind !== 'boxes') continue;
    const tl = result?.tiers.find((t) => t.tierId === tier.id);
    const n = tier.items.length;
    // Current extents of the other items (from the layout, or an even split as a fallback).
    const extents = tier.items.map((it, i) => {
      const li = tl?.items.find((x) => x.id === itemKey(it));
      if (li) return { x0: li.x, x1: li.x + li.width };
      const w = (zr - zl) / Math.max(1, n);
      return { x0: zl + i * w, x1: zl + (i + 1) * w };
    });
    // The layout predates the span, so neighbors will re-flow around it. Anchored spans
    // compare against the edge they're measured from; centered spans against centers.
    let at: number;
    if (span.x.anchor === 'left') at = extents.filter((e) => e.x1 <= left + tol).length;
    else if (span.x.anchor === 'right') at = n - extents.filter((e) => e.x0 >= right - tol).length;
    else at = extents.filter((e) => (e.x0 + e.x1) / 2 < cx).length;
    tier.items.splice(at, 0, { kind: 'slot', spanId });
  }
  return true;
}

/** Add a tall box or gap spanning a tier range. Returns the new span id. */
export function addSpan(project: Project, runId: Id, spec: NewSpan): Id | undefined {
  const run = findRun(project, runId);
  if (!run) return undefined;
  const range = tierRange(run, spec.fromTierId, spec.toTierId);
  if (!range.length) return undefined;
  const span: Span = {
    id: newId(),
    kind: spec.kind,
    name: spec.name,
    x: spec.x ?? { anchor: 'left', offset: 0 },
    width: spec.width,
    tiers: { from: range[0]!, to: range[range.length - 1]! },
    content: spec.content ?? newOpening(spec.kind === 'box' ? { type: 'doorPair' } : { type: 'none' }, spec.kind === 'box' ? 4 : 0),
  };
  if (spec.depth !== undefined) span.depth = spec.depth;
  if (span.name === undefined) delete span.name;
  const layout = safeDerive(project, runId);
  run.spans.push(span);
  placeSpanSlots(project, runId, span.id, layout);
  return span.id;
}

export function removeSpan(run: Run, spanId: Id): boolean {
  const index = run.spans.findIndex((s) => s.id === spanId);
  if (index < 0) return false;
  run.spans.splice(index, 1);
  for (const tier of run.tiers) tier.items = tier.items.filter((it) => !(it.kind === 'slot' && it.spanId === spanId));
  return true;
}

export function setSpanTiers(project: Project, runId: Id, spanId: Id, fromTierId: Id, toTierId: Id): boolean {
  const run = findRun(project, runId);
  const span = run && findSpan(run, spanId);
  if (!run || !span) return false;
  const range = tierRange(run, fromTierId, toTierId);
  if (!range.length) return false;
  span.tiers = { from: range[0]!, to: range[range.length - 1]! };
  return placeSpanSlots(project, runId, spanId);
}

/** Update a span's position/width and re-place its slots. */
export function setSpanGeometry(
  project: Project,
  runId: Id,
  spanId: Id,
  patch: { x?: Span['x']; width?: Ticks; depth?: Ticks | null },
): boolean {
  const run = findRun(project, runId);
  const span = run && findSpan(run, spanId);
  if (!run || !span) return false;
  if (patch.x) span.x = patch.x;
  if (patch.width !== undefined) span.width = patch.width;
  if (patch.depth === null) delete span.depth;
  else if (patch.depth !== undefined) span.depth = patch.depth;
  return placeSpanSlots(project, runId, spanId);
}

// ---------------------------------------------------------------------------
// Run / wall
// ---------------------------------------------------------------------------

/** Edit a hardware type in the project's library (copying the seed catalog into the project first). */
export function updateHardware<K extends keyof HardwareLibrary>(project: Project, kind: K, id: Id, patch: Partial<HardwareLibrary[K][number]>): boolean {
  if (!project.hardware) project.hardware = structuredClone(hardwareOf(project));
  const item = (project.hardware[kind] as { id: Id }[]).find((h) => h.id === id);
  if (!item) return false;
  Object.assign(item, patch);
  return true;
}

/** Set or remove a run's crown or base molding. */
export function setMolding(run: Run, which: 'crown' | 'base', molding: Molding | undefined): void {
  const trim = { ...run.trim };
  if (molding) trim[which] = molding;
  else delete trim[which];
  if (trim.crown || trim.base) run.trim = trim;
  else delete run.trim;
}

/** Add a wall run (default tiers) named "Wall N". Returns its id. */
export function addRun(project: Project, name?: string): Id {
  const run = createDefaultRun(name ?? `Wall ${project.runs.length + 1}`);
  project.runs.push(run);
  return run.id;
}

/** Remove a wall run; a project always keeps at least one. */
export function removeRun(project: Project, runId: Id): boolean {
  if (project.runs.length <= 1) return false;
  const i = project.runs.findIndex((r) => r.id === runId);
  if (i < 0) return false;
  project.runs.splice(i, 1);
  return true;
}

export function setWallLength(run: Run, length: Ticks): boolean {
  const seg = run.wall[0];
  if (!seg) return false;
  seg.length = length;
  return true;
}

export function setCeilingHeight(run: Run, height: Ticks): boolean {
  const seg = run.wall[0];
  if (!seg) return false;
  seg.ceilingHeight = height;
  return true;
}

export function setEndCondition(run: Run, side: 'left' | 'right', condition: EndCondition): void {
  run.ends[side] = condition;
}

// ---------------------------------------------------------------------------
// Settings overrides
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function setDeep(target: Obj, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = target;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k] as Obj;
  }
  cur[keys[keys.length - 1]!] = value;
}

/** Set an override at a scope (run / tier / box / span). */
export function setOverride(scope: SettingsScope, path: string, value: unknown): void {
  const overrides = (scope.overrides ?? {}) as Obj;
  setDeep(overrides, path, value);
  scope.overrides = overrides as SettingsScope['overrides'];
}

/** Clear an override at a scope, pruning empty objects. */
export function clearOverride(scope: SettingsScope, path: string): void {
  if (!scope.overrides) return;
  const keys = path.split('.');
  const stack: Obj[] = [scope.overrides as Obj];
  for (const k of keys.slice(0, -1)) {
    const next = stack[stack.length - 1]![k];
    if (!isObj(next)) return;
    stack.push(next);
  }
  delete stack[stack.length - 1]![keys[keys.length - 1]!];
  for (let i = stack.length - 1; i > 0; i--) {
    if (Object.keys(stack[i]!).length === 0) delete stack[i - 1]![keys[i - 1]!];
  }
  if (Object.keys(scope.overrides).length === 0) delete scope.overrides;
}

/** Set a project-level default (the root of the cascade). */
export function setProjectSetting(project: Project, path: string, value: unknown): void {
  setDeep(project.settings as unknown as Obj, path, value);
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** Every material assignment in the project: project settings, styles, and run/tier/box/span overrides. */
function materialSlots(project: Project): Partial<Record<string, Id>>[] {
  const slots: Partial<Record<string, Id>>[] = [project.settings.materials];
  for (const style of project.styles) if (style.settings.materials) slots.push(style.settings.materials);
  const scopes: SettingsScope[] = [];
  for (const run of project.runs) {
    scopes.push(run, ...run.spans);
    for (const tier of run.tiers) {
      scopes.push(tier);
      for (const item of tier.items) if (item.kind === 'box') scopes.push(item);
    }
  }
  for (const scope of scopes) if (scope.overrides?.materials) slots.push(scope.overrides.materials);
  return slots;
}

/** How many material assignments (anywhere in the settings cascade) use a material. */
export function materialUsage(project: Project, id: Id): number {
  return materialSlots(project).reduce((n, slot) => n + Object.values(slot).filter((v) => v === id).length, 0);
}

/** Add a material to the project's library. Returns its id. */
export function addMaterial(project: Project, material: Omit<Material, 'id'>): Id {
  const id = newId();
  project.materials.push({ ...material, id });
  return id;
}

export function updateMaterial(project: Project, id: Id, patch: Partial<Omit<Material, 'id'>>): boolean {
  const material = project.materials.find((m) => m.id === id);
  if (!material) return false;
  Object.assign(material, patch);
  return true;
}

/** Remove a material nothing uses. Returns false if it's in use or missing. */
export function removeMaterial(project: Project, id: Id): boolean {
  const i = project.materials.findIndex((m) => m.id === id);
  if (i < 0 || materialUsage(project, id) > 0) return false;
  project.materials.splice(i, 1);
  return true;
}

// ---------------------------------------------------------------------------
// Named styles
// ---------------------------------------------------------------------------

/** Every scope that can reference a style: runs, tiers, boxes and spans. */
function styleScopes(project: Project): SettingsScope[] {
  const scopes: SettingsScope[] = [];
  for (const run of project.runs) {
    scopes.push(run, ...run.spans);
    for (const tier of run.tiers) {
      scopes.push(tier);
      for (const item of tier.items) if (item.kind === 'box') scopes.push(item);
    }
  }
  return scopes;
}

/** How many runs, tiers, boxes and spans use a style. */
export function styleUsage(project: Project, styleId: Id): number {
  return styleScopes(project).filter((s) => s.styleId === styleId).length;
}

/** Add a named style (optionally seeded with settings). Returns its id. */
export function addStyle(project: Project, name: string, settings: NamedStyle['settings'] = {}): Id {
  const id = newId();
  project.styles.push({ id, name, settings: structuredClone(settings) });
  return id;
}

export function renameStyle(project: Project, styleId: Id, name: string): boolean {
  const style = project.styles.find((s) => s.id === styleId);
  if (!style || !name) return false;
  style.name = name;
  return true;
}

/** Remove a style; anything using it falls back to what it inherits. */
export function removeStyle(project: Project, styleId: Id): boolean {
  const i = project.styles.findIndex((s) => s.id === styleId);
  if (i < 0) return false;
  project.styles.splice(i, 1);
  for (const scope of styleScopes(project)) if (scope.styleId === styleId) delete scope.styleId;
  return true;
}

export function setScopeStyle(scope: SettingsScope, styleId: Id | undefined): void {
  if (styleId) scope.styleId = styleId;
  else delete scope.styleId;
}

/** Set or clear one setting in a style (dotted path), pruning empty objects. */
export function setStyleSetting(style: NamedStyle, path: string, value: unknown): void {
  const proxy: SettingsScope = { overrides: style.settings };
  setOverride(proxy, path, value);
  style.settings = proxy.overrides ?? {};
}

export function clearStyleSetting(style: NamedStyle, path: string): void {
  const proxy: SettingsScope = { overrides: style.settings };
  clearOverride(proxy, path);
  style.settings = proxy.overrides ?? {};
}

/** Turn a scope's overrides into a new named style and apply it there instead. Returns the style id. */
export function saveOverridesAsStyle(project: Project, scope: SettingsScope, name: string): Id | undefined {
  if (!scope.overrides || Object.keys(scope.overrides).length === 0) return undefined;
  const id = addStyle(project, name, scope.overrides);
  scope.styleId = id;
  delete scope.overrides;
  return id;
}

// ---------------------------------------------------------------------------
// Boundary dragging
// ---------------------------------------------------------------------------

export interface BoundaryItem {
  spec: SizeSpec;
  /** Current resolved size (from the derived layout). */
  size: Ticks;
}

export interface ResizeOptions {
  grid: Ticks;
  /** Smallest size either neighbor may shrink to. */
  minSize?: Ticks;
}

export interface ResizeResult {
  a: SizeSpec;
  b: SizeSpec;
  /** Delta actually applied to `a` after clamping and snapping. */
  delta: Ticks;
}

/**
 * Move the boundary between neighbors `a` (left / lower / upper-in-rows: the item whose size
 * grows with a positive delta) and `b` by `delta`, keeping each item's type:
 *  - a fixed item gets a new fixed size, snapped to the grid;
 *  - between two flex items, their combined ratio is redistributed in proportion to the new sizes;
 *  - fixed + flex changes only the fixed item (the flex item re-flows to absorb it).
 * Sizes respect flex min/max and `minSize`.
 */
export function resizeBoundary(a: BoundaryItem, b: BoundaryItem, delta: Ticks, opts: ResizeOptions): ResizeResult {
  const { grid, minSize = 0 } = opts;
  const total = a.size + b.size;
  const lo = (it: BoundaryItem) => Math.max(minSize, it.spec.kind === 'flex' ? (it.spec.min ?? 0) : 0);
  const hi = (it: BoundaryItem) => (it.spec.kind === 'flex' && it.spec.max !== undefined ? it.spec.max : Infinity);
  const minA = Math.max(lo(a), total - hi(b));
  const maxA = Math.min(hi(a), total - lo(b));
  if (minA > maxA) return { a: a.spec, b: b.spec, delta: 0 };

  const clampA = (v: Ticks) => Math.min(maxA, Math.max(minA, v));
  let newA = clampA(a.size + delta);
  // Snap whichever side ends up with an explicit fixed size.
  const snapSide = a.spec.kind === 'fixed' ? 'a' : b.spec.kind === 'fixed' ? 'b' : 'a';
  if (snapSide === 'a') {
    let s = snap(newA, grid);
    if (s < minA) s = snap(newA, grid, 'up');
    if (s > maxA) s = snap(newA, grid, 'down');
    if (s >= minA && s <= maxA) newA = s;
  } else {
    const newB = total - newA;
    let s = snap(newB, grid);
    if (total - s < minA) s = snap(newB, grid, 'down');
    if (total - s > maxA) s = snap(newB, grid, 'up');
    if (total - s >= minA && total - s <= maxA) newA = total - s;
  }
  const newB = total - newA;

  let specA: SizeSpec = a.spec;
  let specB: SizeSpec = b.spec;
  if (a.spec.kind === 'fixed') specA = { kind: 'fixed', size: newA };
  if (b.spec.kind === 'fixed') specB = { kind: 'fixed', size: newB };
  if (a.spec.kind === 'flex' && b.spec.kind === 'flex' && total > 0) {
    const r = a.spec.ratio + b.spec.ratio;
    const ra = roundRatio((r * newA) / total);
    specA = { ...a.spec, ratio: ra };
    specB = { ...b.spec, ratio: roundRatio(r - ra) };
  }
  return { a: specA, b: specB, delta: newA - a.size };
}

const roundRatio = (r: number): number => Math.round(r * 1e6) / 1e6;
