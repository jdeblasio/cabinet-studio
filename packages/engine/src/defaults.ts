import { SCHEMA_VERSION, type Box, type ConstructionSettings, type Finish, type Front, type HardwareLibrary, type Id, type Material, type Project, type Run, type Section } from './model';
import { DEFAULT_GRID, inches, mm } from './units';

export function newId(): Id {
  return globalThis.crypto.randomUUID();
}

/**
 * Seed hardware catalog: generic types with typical specs. Check your hardware's own spec sheet
 * (clearances and lengths vary by product) and edit the copy in your project.
 */
export const DEFAULT_HARDWARE: HardwareLibrary = {
  slides: [
    { id: 'slide-side-ball', name: 'Side-mount ball-bearing, full extension', mount: 'side', sideClearance: inches(1 / 2), lengths: [10, 12, 14, 16, 18, 20, 22, 24].map(inches) },
    { id: 'slide-under-full', name: 'Undermount, full extension (typical)', mount: 'under', sideClearance: inches(3 / 16), lengths: [9, 12, 15, 18, 21].map(inches) },
  ],
  hinges: [
    { id: 'hinge-concealed-ff', name: 'Concealed 35 mm, face-frame mount', kind: 'concealed', cupDiameter: mm(35) },
    { id: 'hinge-concealed-fl', name: 'Concealed 35 mm, frameless (clip-on)', kind: 'concealed', cupDiameter: mm(35) },
    { id: 'hinge-butt', name: 'Butt hinge (inset doors)', kind: 'butt' },
  ],
  shelfPins: [
    { id: 'pin-5mm', name: '5 mm shelf pins', diameter: mm(5), perShelf: 4 },
    { id: 'pin-1-4', name: '1/4" shelf pins', diameter: inches(1 / 4), perShelf: 4 },
  ],
};

/** The project's hardware library (the seed catalog when it has none). */
export function hardwareOf(project: Pick<Project, 'hardware'>): HardwareLibrary {
  return project.hardware ?? DEFAULT_HARDWARE;
}

export const DEFAULT_CROWN = { height: inches(3.5), projection: inches(2.5) };
export const DEFAULT_BASE_MOLDING = { height: inches(3.5), projection: inches(0.75) };

export const DEFAULT_COUNTERTOP = { thickness: inches(1.5), frontOverhang: inches(1), endOverhang: inches(1) };

export const DEFAULT_MATERIALS: Material[] = [
  {
    id: 'ply-23-32',
    name: 'Plywood 3/4" (23/32" actual)',
    kind: 'sheet',
    thickness: inches(23 / 32),
    color: '#d8b98b',
    sheet: { length: inches(96), width: inches(48), grain: 'length' },
  },
  {
    id: 'ply-7-32',
    name: 'Plywood 1/4" (7/32" actual)',
    kind: 'sheet',
    thickness: inches(7 / 32),
    color: '#e6cfa6',
    sheet: { length: inches(96), width: inches(48), grain: 'length' },
  },
  {
    id: 'ply-15-32',
    name: 'Plywood 1/2" (15/32" actual)',
    kind: 'sheet',
    thickness: inches(15 / 32),
    color: '#e2c79c',
    sheet: { length: inches(96), width: inches(48), grain: 'length' },
  },
  {
    id: 'poplar-3-4',
    name: 'Poplar 3/4"',
    kind: 'lumber',
    thickness: inches(3 / 4),
    color: '#e9e0c4',
  },
  {
    id: 'molding',
    name: 'Molding (bought by length)',
    kind: 'lumber',
    thickness: inches(3 / 4),
    color: '#ede4cc',
  },
  {
    id: 'hardwood-top',
    name: 'Hardwood top 1 1/2"',
    kind: 'lumber',
    thickness: inches(1.5),
    color: '#c99f6e',
  },
];

/** A finish value meaning "no finish: the material's own look". */
export const NATURAL = 'natural';

/** Seed paints, copied into a project when it edits them. */
export const DEFAULT_FINISHES: Finish[] = [
  { id: 'paint-white', name: 'White paint', color: '#f1eee6' },
  { id: 'paint-black', name: 'Black paint', color: '#2f2f2f' },
];

/** The project's paints and finishes (the seed list when it has none). */
export function finishesOf(project: Pick<Project, 'finishes'>): Finish[] {
  return project.finishes ?? DEFAULT_FINISHES;
}

export const DEFAULT_SETTINGS: ConstructionSettings = {
  construction: 'faceFrame',
  joinery: 'butt',
  joineryDepth: inches(1 / 4),
  finishes: {
    carcass: NATURAL,
    back: NATURAL,
    shelves: NATURAL,
    faceFrame: NATURAL,
    fronts: NATURAL,
    toeKick: NATURAL,
    countertop: NATURAL,
    drawerBox: NATURAL,
    drawerBottom: NATURAL,
    frontFrame: NATURAL,
    frontPanel: NATURAL,
    molding: NATURAL,
  },
  materials: {
    carcass: 'ply-23-32',
    back: 'ply-7-32',
    shelves: 'ply-23-32',
    faceFrame: 'poplar-3-4',
    fronts: 'ply-23-32',
    toeKick: 'ply-23-32',
    countertop: 'hardwood-top',
    drawerBox: 'ply-15-32',
    drawerBottom: 'ply-7-32',
    frontFrame: 'poplar-3-4',
    frontPanel: 'ply-7-32',
    molding: 'molding',
  },
  back: 'applied',
  carcass: { top: 'panel', bottom: 'panel' },
  faceFrame: {
    lip: 0,
    topRailWidth: inches(1.5),
    bottomRailWidth: inches(1.5),
    midRailWidth: inches(1.5),
    midStileWidth: inches(1.5),
    scribeAllowance: inches(0.5),
    endStiles: { left: 'flush', right: 'flush' },
  },
  fronts: {
    mounting: 'partialOverlay',
    overlay: inches(0.5),
    reveal: inches(1 / 16),
    pairGap: inches(1 / 8),
    doorStyle: 'slab',
    drawerStyle: 'slab',
    fivePiece: { stileWidth: inches(2.25), railWidth: inches(2.25), panelGroove: inches(3 / 8), panelClearance: inches(1 / 16) },
  },
  hardware: { slide: 'slide-side-ball', hinge: 'hinge-concealed-ff', shelfPin: 'pin-5mm' },
  drawers: {
    topClearance: inches(3 / 4),
    bottomClearance: inches(1 / 4),
    rearClearance: inches(1 / 2),
  },
  shelves: {
    sideClearance: inches(1 / 32),
    frontSetback: inches(1 / 4),
    designLoad: 20,
    maxSagPerFoot: 0.02,
    fixedEdge: 'flush',
    fixedSetback: inches(1 / 4),
  },
  ceilingScribe: inches(0.5),
  edgeBanding: { enabled: true, thickness: 0 },
};

export function opening(front: Front = { type: 'none' }, adjustableShelves = 0): Section {
  return { kind: 'opening', id: newId(), front, adjustableShelves };
}

export function flexBox(content: Section, ratio = 1): Box {
  return { kind: 'box', id: newId(), width: { kind: 'flex', ratio }, content };
}

/** A classic face-frame built-in: base cabinets with door pairs, open bookcases above. */
/** A wall run with the default base and upper tiers. */
export function createDefaultRun(name = 'Wall 1'): Run {
  return {
    id: newId(),
    name,
    wall: [{ id: newId(), length: inches(120), ceilingHeight: inches(96) }],
    ends: { left: 'wall', right: 'wall' },
    spans: [],
    tiers: [
      {
        id: newId(),
        name: 'Base',
        kind: 'boxes',
        height: { kind: 'fixed', size: inches(30) },
        depth: inches(16),
        toeKick: { height: inches(3.5), setback: inches(3) },
        items: [0, 1, 2, 3].map(() => flexBox(opening({ type: 'doorPair' }, 1))),
      },
      {
        id: newId(),
        name: 'Upper',
        kind: 'boxes',
        height: { kind: 'flex', ratio: 1 },
        depth: inches(12),
        items: [0, 1, 2, 3].map(() => flexBox(opening({ type: 'none' }, 3))),
      },
    ],
  };
}

export function createDefaultProject(): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name: 'Untitled built-in',
    units: { system: 'imperial', grid: DEFAULT_GRID.imperial },
    settings: DEFAULT_SETTINGS,
    styles: [],
    materials: DEFAULT_MATERIALS,
    runs: [createDefaultRun()],
  };
}
