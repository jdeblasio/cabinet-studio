/**
 * Derived output: computed from the design model, never persisted.
 * Coordinates are in run space (see model.ts): x along the run from the left wall,
 * y up from the floor, z out from the wall face.
 */
import type { Front, Id, Tier } from './model';
import type { Ticks } from './units';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  /** Stable machine-readable code, e.g. 'tier-overflow'. */
  code: string;
  message: string;
  /** Model element the issue is about (box, tier, span, section, run). */
  sourceId: Id;
}

/** Rectangle in the front elevation plane (x along run, y up). */
export interface Rect {
  x: Ticks;
  y: Ticks;
  width: Ticks;
  height: Ticks;
}

/** Axis-aligned box in run space. (x, y, z) is the min corner; width/height/depth extend along x/y/z. */
export interface Bounds {
  x: Ticks;
  y: Ticks;
  z: Ticks;
  width: Ticks;
  height: Ticks;
  depth: Ticks;
}

export type PartRole =
  | 'side'
  | 'top'
  | 'bottom'
  | 'back'
  | 'fixedShelf'
  | 'adjustableShelf'
  | 'partition'
  | 'stile'
  | 'rail'
  | 'door'
  | 'drawerFront'
  | 'toeKick'
  | 'countertop'
  /** Scribe strips and fillers. */
  | 'filler'
  /** Drawer box sides, front and back. */
  | 'drawerBox'
  | 'drawerBottom'
  /** Stiles and rails of five-piece fronts. */
  | 'frontFrame'
  | 'frontPanel'
  /** Crown and base molding (simplified profiles). */
  | 'molding';

/** A single rectangular piece of material, placed in run space. */
export interface Part {
  /** Stable derived id, e.g. `${boxId}/side-left`. Stable across re-derivations of the same model. */
  id: Id;
  /** Human-readable label, e.g. "Left side". */
  name: string;
  role: PartRole;
  materialId: Id;
  /** Finished size along the grain. Grain is vertical for sides, partitions, backs, stiles and doors; horizontal otherwise. */
  length: Ticks;
  /** Finished size across the grain. */
  width: Ticks;
  thickness: Ticks;
  bounds: Bounds;
  /** Model element this part belongs to (box id, span id, tier id for toe kicks, frame group id). */
  ownerId: Id;
  /** Why the cut size differs from what's visible, e.g. "+1/4" each end into dados". */
  note?: string;
}

export interface RunResult {
  runId: Id;
  /** Wall length (inside face to inside face). */
  width: Ticks;
  ceilingHeight: Ticks;
  /** Space left at the ceiling above the highest tier (ceiling scribe + snap remainder). */
  ceilingGap: Ticks;
  tiers: TierLayout[];
  /** Every box: tier boxes and span boxes. */
  boxes: BoxLayout[];
  /** Span gaps (e.g. doorways). */
  gaps: { spanId: Id; rect: Rect }[];
  frames: FrameGroup[];
  parts: Part[];
  issues: Issue[];
}

export interface TierLayout {
  tierId: Id;
  kind: Tier['kind'];
  /** Bottom of the band and its full height (including toe kick). */
  y: Ticks;
  height: Ticks;
  depth: Ticks;
  /** Toe kick height (0 if none). Carcasses in this tier start at y + toeKick. */
  toeKick: Ticks;
  /** Countertop thickness (0 if none). Carcasses in this tier end at y + height − countertop. */
  countertop: Ticks;
  /** Space between the wall and the first/last carcass in this tier (0 at open ends). */
  scribe: { left: Ticks; right: Ticks };
  /** Resolved items left → right (boxes and span slots), for selection and drag handles. */
  items: { kind: 'box' | 'slot'; id: Id; x: Ticks; width: Ticks }[];
}

export interface BoxLayout {
  /** Box.id for tier boxes, Span.id for span boxes. */
  id: Id;
  source: 'tier' | 'span';
  /** Owning tier (tier boxes) or bottom spanned tier (span boxes). */
  tierId: Id;
  carcass: Bounds;
  /** Every node of the box's section tree, flattened, parents before children. */
  sections: SectionLayout[];
}

export interface SectionLayout {
  sectionId: Id;
  kind: 'split' | 'opening';
  parentId?: Id;
  /** Clear face opening (inside the face frame) for openings; the region covered by the split for splits. */
  rect: Rect;
  /** Openings only. */
  front?: Front;
}

/** A continuous face frame: all boxes whose fronts are coplanar and touching. */
export interface FrameGroup {
  id: Id;
  /** z of the frame's back face (= carcass front). */
  z: Ticks;
  boxIds: Id[];
}
