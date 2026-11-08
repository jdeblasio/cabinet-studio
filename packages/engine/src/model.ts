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
  /** Hardware library; the built-in seed catalog when missing. */
  hardware?: HardwareLibrary;
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
  /** Stiffness (modulus of elasticity) in psi, for the shelf sag check. Defaults by kind. */
  modulus?: number;
}

export type ConstructionStyle = 'faceFrame' | 'frameless';
export type Mounting = 'partialOverlay' | 'fullOverlay' | 'inset';
/** Milestone 1 supports butt joints only. */
/**
 * Carcass joinery preset. Butt, dowel and confirmat joints don't change part sizes. Dado and
 * rabbet joints capture tops, bottoms, fixed shelves and partitions in grooves `joineryDepth`
 * deep, so those parts are cut that much longer at each captured end.
 */
export type Joinery = 'butt' | 'dowel' | 'confirmat' | 'dado' | 'rabbet';

/**
 * Face frame stile at a box's open edge (no neighbor in the same frame, not at a wall —
 * e.g. beside a gap, at an open run end, or next to a box with a different face plane).
 *  - 'flush': the stile stops at the outside of the box side (side thickness + lip wide).
 *  - 'full': the stile is as wide as a shared stile and centered on the box edge, overhanging
 *    the side by side thickness + lip, so it lines up with shared stiles above or below.
 */
export type EndStile = 'flush' | 'full';

/**
 * A carcass top or bottom. 'open' leaves out the panel and the face frame rail on that edge, so
 * the opening runs to the carcass edge: a countertop below shows as the bottom shelf, or shelving
 * continues into the box above without a doubled panel and rail.
 */
export type CarcassEnd = 'panel' | 'open';

/** Slab: one flat panel. Five-piece (Shaker): two stiles, two rails and a panel in grooves. */
export type FrontStyle = 'slab' | 'fivePiece';

export interface ConstructionSettings {
  construction: ConstructionStyle;
  joinery: Joinery;
  /** Depth of dados and rabbets. */
  joineryDepth: Ticks;
  /** Material ids by part role. */
  materials: {
    carcass: Id;
    back: Id;
    shelves: Id;
    faceFrame: Id;
    fronts: Id;
    toeKick: Id;
    countertop: Id;
    /** Drawer box sides, front and back. */
    drawerBox: Id;
    drawerBottom: Id;
    /** Stiles and rails of five-piece doors and drawer fronts (lumber). */
    frontFrame: Id;
    /** Panels of five-piece doors and drawer fronts. */
    frontPanel: Id;
    /** Crown and base molding stock. */
    molding: Id;
  };
  back: 'applied' | 'none';
  carcass: { top: CarcassEnd; bottom: CarcassEnd };
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
    /**
     * Stile-only column dividers. A stile over a partition always matches a shared stile
     * (2 × (side thickness + lip)), so a partitioned box looks like boxes side by side.
     */
    midStileWidth: Ticks;
    /** Minimum space between a wall and the first/last carcass; the end stile covers it and gets scribed. */
    scribeAllowance: Ticks;
    /** Stile style at each box's open left/right edge. Edges at a wall or shared with a neighbor are unaffected. */
    endStiles: { left: EndStile; right: EndStile };
  };
  fronts: {
    mounting: Mounting;
    /** Partial overlay: how far a front overlaps the frame on each edge. */
    overlay: Ticks;
    /** Inset: gap around a front. Full overlay: gap between adjacent fronts. */
    reveal: Ticks;
    /** Gap between the two doors of a pair. */
    pairGap: Ticks;
    doorStyle: FrontStyle;
    drawerStyle: FrontStyle;
    fivePiece: {
      stileWidth: Ticks;
      railWidth: Ticks;
      /** Depth of the panel groove; rails get stub tenons this long on each end. */
      panelGroove: Ticks;
      /** Gap per side between the panel and the bottom of its groove (for seasonal movement). */
      panelClearance: Ticks;
    };
  };
  /** Which hardware from the project's library to use (see Project.hardware). */
  hardware: { slide: Id; hinge: Id; shelfPin: Id };
  /** Drawer boxes, sized from the opening and the chosen slides. */
  drawers: {
    /** Space between the box and the top / bottom of the frame opening. */
    topClearance: Ticks;
    bottomClearance: Ticks;
    /** Minimum space behind the box. */
    rearClearance: Ticks;
  };
  shelves: {
    /** Adjustable shelf clearance per side (to the carcass side / partition). */
    sideClearance: Ticks;
    /** Adjustable shelf setback from the front of the carcass. */
    frontSetback: Ticks;
    /** Load for the shelf sag check, pounds per square foot of shelf. */
    designLoad: number;
    /** Largest acceptable sag, inches per foot of span. */
    maxSagPerFoot: number;
  };
  /** Minimum gap left at the ceiling for scribing (top of the highest tier). */
  ceilingScribe: Ticks;
  /**
   * Edge banding on exposed plywood edges: adjustable shelf fronts; slab plywood doors and drawer
   * fronts (all four edges); and, for frameless boxes, the front edges of the carcass and fixed
   * shelves. Banded parts are cut smaller by `thickness` per banded edge (0 for veneer tape).
   */
  edgeBanding: { enabled: boolean; thickness: Ticks };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** A drawer slide type. The box depth is the longest available length that fits. */
export interface SlideSpec {
  id: Id;
  name: string;
  mount: 'side' | 'under';
  /** Space per side between the drawer box and the cabinet side. */
  sideClearance: Ticks;
  lengths: Ticks[];
}

/** A hinge type. Count per door grows with door height (see the shopping list). */
export interface HingeSpec {
  id: Id;
  name: string;
  kind: 'concealed' | 'butt' | 'other';
  /** Cup diameter for concealed hinges (e.g. 35 mm), for drilling. */
  cupDiameter?: Ticks;
}

export interface ShelfPinSpec {
  id: Id;
  name: string;
  diameter: Ticks;
  /** Pins per adjustable shelf. */
  perShelf: number;
}

/** The project's hardware library: generic types users can copy and edit. */
export interface HardwareLibrary {
  slides: SlideSpec[];
  hinges: HingeSpec[];
  shelfPins: ShelfPinSpec[];
}

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
  /** Moldings along the run, as simplified profiles (bounding boxes). */
  trim?: { crown?: Molding; base?: Molding };
}

/** A molding's profile, simplified to its bounding box. */
export interface Molding {
  /** Height on the wall. */
  height: Ticks;
  /** How far it projects from the face it's applied to. */
  projection: Ticks;
}

export interface WallSegment {
  id: Id;
  /** Wall length (inside corner to inside corner). */
  length: Ticks;
  ceilingHeight: Ticks;
  /**
   * Extra measurements of a wall that isn't straight or square (e.g. its length at the floor,
   * middle and ceiling; the ceiling height at each end). Boxes fit the tightest; scribe stiles
   * are cut wide enough to scribe to the widest.
   */
  measuredLengths?: Ticks[];
  measuredCeilings?: Ticks[];
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
  /**
   * A finished top over this tier's boxes, inside the tier's height (carcasses get shorter so the
   * counter surface stays put). One piece per contiguous run of boxes. It runs to a wall, overhangs
   * open ends and gaps by `endOverhang`, and stops at any other box. Its thickness is set here; the
   * countertop material (settings) gives species and color.
   */
  countertop?: Countertop;
  /** Left → right. A SpanSlot marks where a spanning element passes through this tier. */
  items: TierItem[];
}

export interface Countertop {
  thickness: Ticks;
  /** Past the face of the face frame. */
  frontOverhang: Ticks;
  /** Past the outside of the end box (or its end stile) at an open end or a gap. */
  endOverhang: Ticks;
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
  /**
   * Gaps only: the countertop of the top tier this gap passes through continues over it as one
   * piece (e.g. a desk top over knee space between two base cabinets).
   */
  bridgeCountertop?: boolean;
  /** Face layout for kind 'box'; ignored for gaps. */
  content: Section;
}
