/**
 * Hardware and edge banding estimates from the derived design. Quantities only, no prices.
 * Hinge, slide and shelf pin types come from each box's settings (`settings.hardware`) and the
 * project's hardware library; lines are grouped by type.
 *
 * Assumptions (rules of thumb):
 *  - Hinges: 2 per door up to 40" tall, one more for each further 20" or part of it
 *    (3 up to 60", 4 up to 80", ...). Door height is the opening's clear height.
 *    Doors and drawers are counted from openings, not parts, since a 5-piece front is several parts.
 *  - Shelf pins: the pin type's `perShelf` per adjustable shelf.
 *  - Drawer slides: 1 pair per drawer, as long as the derived drawer box. Without a drawer box
 *    (e.g. no slide length fits), the longest length of the slide type that fits the box's
 *    inside depth (its side panel's depth) less 1/2" rear clearance, or "no length fits".
 *  - Edge banding: the derivation records each banded part's banded length (`Part.banding`), and
 *    those are summed. Banding width follows the part thickness; allow 1" extra per edge (1/2"
 *    overhang at each end, trimmed flush); doors and drawer fronts count 4 edges, other parts 1.
 *    Fallback for projects whose settings predate edge banding (no `settings.edgeBanding`): band
 *    the front edge of sheet-good shelves and all four edges of sheet-good doors and drawer fronts.
 */
import { DEFAULT_HARDWARE, hardwareOf } from '../defaults';
import type { BoxLayout, Part, RunResult } from '../derived';
import { formatLength } from '../format';
import type { ConstructionSettings, Id, Project, SettingsScope } from '../model';
import { resolveSettings } from '../settings';
import { inches, type Ticks } from '../units';

export type HardwareKind = 'hinge' | 'shelfPin' | 'drawerSlide';

export interface HardwareLine {
  kind: HardwareKind;
  /** Generic item, e.g. "Hinges". */
  label: string;
  /** Hardware type from the library, e.g. "Concealed 35 mm, face-frame mount". */
  typeId?: Id;
  typeName?: string;
  qty: number;
  unit: 'each' | 'pair';
  /** Drawer slides: length, or null when no length of the type fits. */
  length?: Ticks | null;
  /** How the quantity was estimated. */
  basis: string;
}

export interface EdgeBandingLine {
  /** Banding width (the part thickness). */
  thickness: Ticks;
  /** Number of banded edges. */
  edges: number;
  parts: number;
  /** Net banded length. */
  length: Ticks;
  /** Net length plus the per-edge trimming allowance. */
  purchaseLength: Ticks;
}

export interface HardwareEstimate {
  doors: number;
  drawers: number;
  hardware: HardwareLine[];
  edgeBanding: EdgeBandingLine[];
}

export const HINGE_RULE = { baseHeight: inches(40), baseCount: 2, step: inches(20) };
export const SLIDE_REAR_CLEARANCE = inches(1 / 2);
export const EDGE_BANDING_ALLOWANCE = inches(1);

/** Hinges for a door of `height`. */
export function hingesFor(height: Ticks): number {
  const { baseHeight, baseCount, step } = HINGE_RULE;
  return height <= baseHeight ? baseCount : baseCount + Math.ceil((height - baseHeight) / step);
}

/** Longest of `lengths` that fits `depth` (inside depth) with the rear clearance, or null. */
export function slideLengthFor(depth: Ticks, lengths: readonly Ticks[]): Ticks | null {
  const fits = lengths.filter((l) => l + SLIDE_REAR_CLEARANCE <= depth);
  return fits.length ? Math.max(...fits) : null;
}

/** Effective settings of a derived box (tier box: run → tier → box; span box: run → span). */
function boxSettings(project: Project, runId: Id, box: BoxLayout): ConstructionSettings {
  const run = project.runs.find((r) => r.id === runId);
  if (!run) return project.settings;
  if (box.source === 'span') return resolveSettings(project, [run, run.spans.find((s) => s.id === box.id) as SettingsScope | undefined]);
  for (const tier of run.tiers) {
    const b = tier.items.find((it) => it.kind === 'box' && it.id === box.id);
    if (b) return resolveSettings(project, [run, tier, b as SettingsScope]);
  }
  return resolveSettings(project, [run]);
}

const isSheet = (project: Project, p: Part) => project.materials.find((m) => m.id === p.materialId)?.kind === 'sheet';

interface Tally {
  typeId: Id;
  typeName: string;
  qty: number;
  count: number;
  length?: Ticks | null;
}

export function estimateHardware(project: Project, results: readonly RunResult[]): HardwareEstimate {
  const lib = hardwareOf(project);
  const f = (t: Ticks) => formatLength(t, project.units.system);
  const hingeType = (id: Id | undefined) => lib.hinges.find((h) => h.id === id) ?? lib.hinges[0] ?? DEFAULT_HARDWARE.hinges[0]!;
  const pinType = (id: Id | undefined) => lib.shelfPins.find((p) => p.id === id) ?? lib.shelfPins[0] ?? DEFAULT_HARDWARE.shelfPins[0]!;
  const slideType = (id: Id | undefined) => lib.slides.find((s) => s.id === id) ?? lib.slides[0] ?? DEFAULT_HARDWARE.slides[0]!;

  let doors = 0;
  let drawers = 0;
  const hinges = new Map<string, Tally>();
  const pins = new Map<string, Tally>();
  const slides = new Map<string, Tally>();
  const tally = (m: Map<string, Tally>, key: string, base: Omit<Tally, 'qty' | 'count'>, qty: number, count: number) => {
    const t = m.get(key) ?? { ...base, qty: 0, count: 0 };
    t.qty += qty;
    t.count += count;
    m.set(key, t);
  };

  for (const r of results) {
    const boxIds = new Set(r.boxes.map((b) => b.id));
    const shelvesBy = new Map<Id, number>();
    for (const p of r.parts) if (p.role === 'adjustableShelf') shelvesBy.set(p.ownerId, (shelvesBy.get(p.ownerId) ?? 0) + 1);

    for (const box of r.boxes) {
      const hw = boxSettings(project, r.runId, box).hardware as Partial<ConstructionSettings['hardware']> | undefined;
      const side = r.parts.find((p) => p.ownerId === box.id && p.role === 'side');
      const depth = side ? side.width : box.carcass.depth;
      for (const sec of box.sections) {
        if (sec.kind !== 'opening' || !sec.front) continue;
        const fr = sec.front;
        if (fr.type === 'door' || fr.type === 'doorPair') {
          const n = fr.type === 'door' ? 1 : 2;
          doors += n;
          const h = hingeType(hw?.hinge);
          tally(hinges, h.id, { typeId: h.id, typeName: h.name }, n * hingesFor(sec.rect.height), n);
        } else if (fr.type === 'drawer') {
          drawers++;
          const sl = slideType(hw?.slide);
          const drawerSide = r.parts.find((p) => p.id === `${sec.sectionId}/drawer-side-left`);
          const length = drawerSide ? drawerSide.length : slideLengthFor(depth, sl.lengths);
          tally(slides, `${sl.id}|${length}`, { typeId: sl.id, typeName: sl.name, length }, 1, 1);
        }
      }
      const shelves = shelvesBy.get(box.id) ?? 0;
      if (shelves > 0) {
        const pin = pinType(hw?.shelfPin);
        tally(pins, pin.id, { typeId: pin.id, typeName: pin.name }, shelves * pin.perShelf, shelves);
      }
    }
    // Adjustable shelves not owned by a derived box (shouldn't happen): project-level pin type.
    let orphan = 0;
    for (const [owner, n] of shelvesBy) if (!boxIds.has(owner)) orphan += n;
    if (orphan > 0) {
      const pin = pinType((project.settings.hardware as Partial<ConstructionSettings['hardware']> | undefined)?.shelfPin);
      tally(pins, pin.id, { typeId: pin.id, typeName: pin.name }, orphan * pin.perShelf, orphan);
    }
  }

  const hardware: HardwareLine[] = [];
  for (const t of hinges.values()) {
    hardware.push({
      kind: 'hinge',
      label: 'Hinges',
      typeId: t.typeId,
      typeName: t.typeName,
      qty: t.qty,
      unit: 'each',
      basis: `${t.count} door${t.count === 1 ? '' : 's'}: ${HINGE_RULE.baseCount} per door up to ${f(HINGE_RULE.baseHeight)} tall, one more per extra ${f(HINGE_RULE.step)}`,
    });
  }
  for (const t of pins.values()) {
    const per = t.count > 0 ? t.qty / t.count : 0;
    hardware.push({
      kind: 'shelfPin',
      label: 'Shelf pins',
      typeId: t.typeId,
      typeName: t.typeName,
      qty: t.qty,
      unit: 'each',
      basis: `${t.count} adjustable shel${t.count === 1 ? 'f' : 'ves'}, ${per} pins each`,
    });
  }
  const byName = (a: Tally, b: Tally) => (a.typeName < b.typeName ? -1 : a.typeName > b.typeName ? 1 : 0);
  for (const t of [...slides.values()].sort((a, b) => byName(a, b) || (b.length ?? -1) - (a.length ?? -1))) {
    hardware.push({
      kind: 'drawerSlide',
      label: 'Drawer slides',
      typeId: t.typeId,
      typeName: t.typeName,
      qty: t.qty,
      unit: 'pair',
      length: t.length ?? null,
      basis: t.length == null ? 'No length of this slide fits the box depth' : '1 pair per drawer, as long as the drawer box',
    });
  }

  return { doors, drawers, hardware, edgeBanding: edgeBanding(project, results) };
}

function edgeBanding(project: Project, results: readonly RunResult[]): EdgeBandingLine[] {
  const banding = new Map<Ticks, { edges: number; parts: number; length: Ticks }>();
  const band = (t: Ticks, edges: number, length: Ticks) => {
    const b = banding.get(t) ?? { edges: 0, parts: 0, length: 0 };
    b.edges += edges;
    b.parts += 1;
    b.length += length;
    banding.set(t, b);
  };
  const parts = results.flatMap((r) => r.parts);
  const fourEdges = (p: Part) => p.role === 'door' || p.role === 'drawerFront';
  if (parts.some((p) => p.banding !== undefined)) {
    for (const p of parts) if (p.banding && p.banding > 0) band(p.thickness, fourEdges(p) ? 4 : 1, p.banding);
  } else if ((project.settings as Partial<ConstructionSettings>).edgeBanding === undefined) {
    for (const p of parts) {
      if (!isSheet(project, p)) continue;
      if (p.role === 'fixedShelf' || p.role === 'adjustableShelf') band(p.thickness, 1, p.length);
      else if (fourEdges(p)) band(p.thickness, 4, 2 * (p.length + p.width));
    }
  }
  return [...banding.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([thickness, b]) => ({ thickness, edges: b.edges, parts: b.parts, length: b.length, purchaseLength: b.length + b.edges * EDGE_BANDING_ALLOWANCE }));
}
