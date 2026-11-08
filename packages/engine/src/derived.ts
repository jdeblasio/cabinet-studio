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
  /** Total length of edge banding applied to this part (finished edge lengths). */
  banding?: Ticks;
  /** Which faces of the part's bounds are banded edges (e.g. a shelf's 'front'; a door's four sides). */
  bandedEdges?: EdgeFace[];
  /**
   * Ends cut at 45° to meet another part at an outside corner (no end grain shows there). The
   * part's bounds run to the corner's outside; the cut takes away the corner on the inside.
   */
  mitres?: Mitre[];
  /** Exposed stretches of unbanded plywood edges (sheet goods only): seen, but neither banded nor covered. */
  rawEdges?: RawEdge[];
  /** Machining: holes drilled into this part (shelf pins, hinge cups). */
  features?: PartFeature[];
  /** Paint or finish over the material (a Finish id); none for the material's own look. */
  finishId?: Id;
}

/** A face of a part's bounds, named by the direction it faces in run space (x: left/right, y: bottom/top, z: back/front). */
export type EdgeFace = 'left' | 'right' | 'bottom' | 'top' | 'back' | 'front';

/**
 * A mitered end: the part's `face` is cut at 45°, the long point on its `outer` face (the face on
 * the outside of the corner). E.g. a toe kick front board: face 'right', outer 'front'.
 */
export interface Mitre {
  face: EdgeFace;
  outer: EdgeFace;
}

/** An exposed stretch of a raw (unbanded) edge: on `face`, from `from` to `to` along `axis`. */
export interface RawEdge {
  face: EdgeFace;
  axis: 'x' | 'y' | 'z';
  from: Ticks;
  to: Ticks;
}

/** Shop wording for a part's banded edges, e.g. "Front edge" or "All 4 edges". */
export function describeBandedEdges(edges: readonly EdgeFace[] | undefined): string {
  if (!edges?.length) return '';
  if (edges.length === 1) return `${edges[0]!.charAt(0).toUpperCase()}${edges[0]!.slice(1)} edge`;
  if (edges.length === 4 && !edges.includes('front') && !edges.includes('back')) return 'All 4 edges';
  return `${edges.join(', ').replace(/^./, (c) => c.toUpperCase())} edges`;
}

/** A hole drilled into a part, in run space: centered at (x, y, z) on the part's face, along `axis`. */
export interface PartFeature {
  kind: 'hole';
  /** e.g. "Shelf pin", "Hinge cup". */
  label: string;
  x: Ticks;
  y: Ticks;
  z: Ticks;
  axis: 'x' | 'y' | 'z';
  diameter: Ticks;
  depth: Ticks;
}

/** A simple solid approximating a piece of hardware. */
export type HardwareShape =
  | { kind: 'box'; bounds: Bounds }
  /** A cylinder centered at (x, y, z), running along `axis`. */
  | { kind: 'cylinder'; x: Ticks; y: Ticks; z: Ticks; axis: 'x' | 'y' | 'z'; diameter: Ticks; length: Ticks };

export type HardwareItemKind = 'drawerSlide' | 'hinge' | 'shelfPin';

/**
 * Hardware placed for illustration (3D view): drawer slides, hinges and shelf pins as simple
 * solids. Not cut parts; the shopping list counts hardware separately.
 */
export interface HardwareItem {
  /** Stable derived id, e.g. `${partId}/slide`. */
  id: Id;
  kind: HardwareItemKind;
  /** e.g. "Drawer slide, 18"". */
  name: string;
  /** Hardware type from the project's library. */
  typeId: Id;
  /** Owning box. */
  ownerId: Id;
  /** The part it's fastened to; it moves with that part in an exploded view. */
  partId: Id;
  shapes: HardwareShape[];
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
  /** Hardware for illustration (slides, hinges, shelf pins). */
  hardware: HardwareItem[];
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
