import { SCHEMA_VERSION, type Box, type ConstructionSettings, type Front, type Id, type Material, type Project, type Section } from './model';
import { DEFAULT_GRID, inches } from './units';

export function newId(): Id {
  return globalThis.crypto.randomUUID();
}

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
    id: 'hardwood-top',
    name: 'Hardwood top 1 1/2"',
    kind: 'lumber',
    thickness: inches(1.5),
    color: '#c99f6e',
  },
];

export const DEFAULT_SETTINGS: ConstructionSettings = {
  construction: 'faceFrame',
  joinery: 'butt',
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
  drawers: {
    slideClearance: inches(1 / 2),
    topClearance: inches(3 / 4),
    bottomClearance: inches(1 / 4),
    rearClearance: inches(1 / 2),
    slideLengths: [10, 12, 14, 16, 18, 20, 22, 24].map(inches),
  },
  shelves: {
    sideClearance: inches(1 / 32),
    frontSetback: inches(1 / 4),
    designLoad: 20,
    maxSagPerFoot: 0.02,
  },
  ceilingScribe: inches(0.5),
};

export function opening(front: Front = { type: 'none' }, adjustableShelves = 0): Section {
  return { kind: 'opening', id: newId(), front, adjustableShelves };
}

export function flexBox(content: Section, ratio = 1): Box {
  return { kind: 'box', id: newId(), width: { kind: 'flex', ratio }, content };
}

/** A classic face-frame built-in: base cabinets with door pairs, open bookcases above. */
export function createDefaultProject(): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name: 'Untitled built-in',
    units: { system: 'imperial', grid: DEFAULT_GRID.imperial },
    settings: DEFAULT_SETTINGS,
    styles: [],
    materials: DEFAULT_MATERIALS,
    runs: [
      {
        id: newId(),
        name: 'Wall 1',
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
      },
    ],
  };
}
