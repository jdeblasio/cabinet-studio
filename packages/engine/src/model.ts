/**
 * Design model: the user's intent, persisted in project files.
 * Everything else (layout, parts, drawings, cut lists) is derived from this.
 *
 * Coordinate conventions used by derived output (see derived.ts):
 *   x: along the run, 0 = inside face of the left wall, increasing to the right
 *   y: up, 0 = floor
 *   z: out from the wall, 0 = wall face, increasing into the room
 */
import type { Ticks, UnitSystem } from './units';

export type Id = string;

/** Size along one axis: an explicit length, or a share of the remaining space (CSS flex-like). */
export type SizeSpec =
  | { kind: 'fixed'; size: Ticks }
  | { kind: 'flex'; ratio: number; min?: Ticks; max?: Ticks };

export const SCHEMA_VERSION = 1;

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION;
  id: Id;
  name: string;
  units: { system: UnitSystem; grid: Ticks };
  /** Project-level defaults: the root of the settings cascade. Always complete. */
  settings: ConstructionSettings;
  styles: NamedStyle[];
  materials: Material[];
  runs: Run[];
}

export interface Material {
  id: Id;
  name: string;
  kind: 'sheet' | 'lumber';
  /** Actual (not nominal) thickness. */
  thickness: Ticks;
  /** Display color (hex) for 2D/3D rendering. */
  color: string;
  /** Sheet goods only; used by the optimizer (milestone 2). */
  sheet?: { length: Ticks; width: Ticks; grain: 'length' | 'none' };
}

export type ConstructionStyle = 'faceFrame' | 'frameless';
export type Mounting = 'partialOverlay' | 'fullOverlay' | 'inset';
/** Milestone 1 supports butt joints only. */
export type Joinery = 'butt';

export interface ConstructionSettings {
  construction: ConstructionStyle;
  joinery: Joinery;
  /** Material ids by part role. */
  materials: {
    carcass: Id;
    back: Id;
    shelves: Id;
    faceFrame: Id;
    fronts: Id;
    toeKick: Id;
  };
  back: 'applied' | 'none';
  faceFrame: {
    /**
     * How far the frame overhangs the box interior on each side. 0 = "flush inside":
     * frame inner edges line up with box side inner faces, so a shared stile between two
     * boxes is exactly 2 × side thickness.
     */
    lip: Ticks;
    topRailWidth: Ticks;
    bottomRailWidth: Ticks;
    midRailWidth: Ticks;
    midStileWidth: Ticks;
    /** Minimum space between a wall and the first/last carcass; the end stile covers it and gets scribed. */
    scribeAllowance: Ticks;
  };
  fronts: {
    mounting: Mounting;
    /** Partial overlay: how far a front overlaps the frame on each edge. */
    overlay: Ticks;
    /** Inset: gap around a front. Full overlay: gap between adjacent fronts. */
    reveal: Ticks;
    /** Gap between the two doors of a pair. */
    pairGap: Ticks;
  };
  shelves: {
    /** Adjustable shelf clearance per side (to the carcass side / partition). */
    sideClearance: Ticks;
    /** Adjustable shelf setback from the front of the carcass. */
    frontSetback: Ticks;
  };
  /** Minimum gap left at the ceiling for scribing (top of the highest tier). */
  ceilingScribe: Ticks;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface NamedStyle {
  id: Id;
  name: string;
  settings: DeepPartial<ConstructionSettings>;
}

/**
 * Anything that participates in the settings cascade
 * (Project → Run → Tier → Box/Span). Effective settings at a level are:
 *   parent effective ⊕ style(styleId) ⊕ overrides
 */
export interface SettingsScope {
  styleId?: Id;
  overrides?: DeepPartial<ConstructionSettings>;
}

export interface Run extends SettingsScope {
  id: Id;
  name: string;
  /** Connected wall segments in order. Milestone 1 supports exactly one (a straight run). */
  wall: WallSegment[];
  ends: { left: EndCondition; right: EndCondition };
  /** Bottom → top. */
  tiers: Tier[];
  /** Run-level elements that span one or more tiers (tall boxes, floor gaps such as doorways). */
  spans: Span[];
}

export interface WallSegment {
  id: Id;
  /** Nominal wall length (inside corner to inside corner). Measured irregularity arrives in milestone 3. */
  length: Ticks;
  ceilingHeight: Ticks;
  /** Angle to the next segment in degrees (for future corners). Unused while runs are straight. */
  angleToNext?: number;
}

/** 'wall': the run butts a wall (scribe stile). 'open': finished end. */
export type EndCondition = 'wall' | 'open';

export interface Tier extends SettingsScope {
  id: Id;
  name: string;
  /** 'boxes' holds cabinets; 'space' is an empty band (e.g. counter/backsplash zone, soffit). */
  kind: 'boxes' | 'space';
  /** Height of the band, including any toe kick. */
  height: SizeSpec;
  /** Carcass depth including the back, excluding face frame and fronts. */
  depth: Ticks;
  /**
   * Only honored on the bottom tier. Boxes sit on a recessed base platform `height` tall whose
   * kick board is set back `setback` from the face of the face frame.
   */
  toeKick?: { height: Ticks; setback: Ticks };
  /** Left → right. A SpanSlot marks where a spanning element passes through this tier. */
  items: TierItem[];
}

export type TierItem = Box | SpanSlot;

export interface SpanSlot {
  kind: 'slot';
  spanId: Id;
}

export interface Box extends SettingsScope {
  kind: 'box';
  id: Id;
  name?: string;
  /** Carcass width (outside of side to outside of side). */
  width: SizeSpec;
  content: Section;
}

/**
 * A box's face is divided recursively. Sizes of split children are clear opening sizes
 * (inside the face frame), so "a 6 in drawer opening" means what a woodworker expects.
 */
export type Section = Split | Opening;

export interface Split {
  kind: 'split';
  id: Id;
  /** rows: stacked top → bottom; columns: left → right. */
  direction: 'rows' | 'columns';
  /**
   * 'panel': each boundary gets a carcass panel (fixed shelf for rows, partition for columns)
   * plus a frame member (mid rail / mid stile). 'frameOnly': frame member only (e.g. drawer banks).
   */
  divider: 'panel' | 'frameOnly';
  children: SplitChild[];
}

export interface SplitChild {
  size: SizeSpec;
  section: Section;
}

export interface Opening {
  kind: 'opening';
  id: Id;
  front: Front;
  /** Evenly spaced adjustable shelves inside this opening. */
  adjustableShelves: number;
}

export type Front =
  | { type: 'none' }
  | { type: 'door'; hinge: 'left' | 'right' }
  | { type: 'doorPair' }
  | { type: 'drawer' };

export interface Span extends SettingsScope {
  id: Id;
  /** 'box': a tall carcass spanning tiers. 'gap': reserved empty space (e.g. a doorway). */
  kind: 'box' | 'gap';
  name?: string;
  /**
   * Horizontal position of the carcass (or gap) edge, measured from the carcass zone edge
   * at the anchored end (i.e. after the minimum wall scribe), or from the zone center.
   */
  x: { anchor: 'left' | 'right' | 'center'; offset: Ticks };
  /** Fixed width (spans reserve fixed-width slots in each tier they pass through). */
  width: Ticks;
  /** Inclusive, contiguous range of tier ids, bottom → top. */
  tiers: { from: Id; to: Id };
  /** Carcass depth; defaults to the bottom spanned tier's depth. */
  depth?: Ticks;
  /** Face layout for kind 'box'; ignored for gaps. */
  content: Section;
}
