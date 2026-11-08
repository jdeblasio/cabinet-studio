/** Shopping list: quantities only (sheets, boards and board feet, moldings by length, hardware, edge banding). No prices. */
import type { Id } from '../model';
import type { Ticks } from '../units';
import type { CutList, CutListGroup } from './cutlist';
import type { EdgeBandingLine, HardwareEstimate, HardwareLine } from './hardware';
import type { LumberResult } from './lumber';
import type { SheetNesting } from './sheets';

export interface SheetPurchase {
  materialId: Id;
  name: string;
  thickness: Ticks;
  length: Ticks;
  width: Ticks;
  count: number;
  /** Part area / area of the sheets bought. */
  utilization: number;
  /** Parts that fit no sheet (not covered by `count`). */
  unplaced: number;
}

export interface LumberPurchase {
  materialId: Id;
  name: string;
  thickness: Ticks;
  /** Rip width. */
  width: Ticks;
  /** Boards per stock length, shortest first. */
  stock: { length: Ticks; count: number }[];
  boards: number;
  boardFeet: number;
  /** Pieces longer than every stock board (not covered by `stock`). */
  tooLong: number;
}

/** Material bought by length (moldings), per material and profile size. */
export interface LinearPurchase {
  materialId: Id;
  name: string;
  /** Profile bounding size. */
  width: Ticks;
  thickness: Ticks;
  pieces: number;
  /** Net total length of the pieces (add for miters and waste). */
  length: Ticks;
  /** Longest single piece. */
  longest: Ticks;
}

export interface ShoppingList {
  sheets: SheetPurchase[];
  lumber: LumberPurchase[];
  /** Board feet per lumber material. */
  lumberByMaterial: { materialId: Id; name: string; boards: number; boardFeet: number }[];
  boardFeet: number;
  /** Moldings and other material bought by length. */
  byLength: LinearPurchase[];
  hardware: HardwareLine[];
  edgeBanding: EdgeBandingLine[];
  /** Number of parts covered by nothing above (they don't fit a sheet or a board). */
  unplacedParts: number;
}

function linearPurchases(groups: readonly CutListGroup[]): LinearPurchase[] {
  const out = new Map<string, LinearPurchase>();
  for (const g of groups) {
    for (const r of g.rows) {
      if (!r.byLength) continue;
      const key = `${g.materialId}|${r.width}|${r.thickness}`;
      const l = out.get(key) ?? { materialId: g.materialId, name: g.name, width: r.width, thickness: r.thickness, pieces: 0, length: 0, longest: 0 };
      l.pieces += r.qty;
      l.length += r.qty * r.length;
      l.longest = Math.max(l.longest, r.length);
      out.set(key, l);
    }
  }
  return [...out.values()];
}

export function buildShoppingList(sheets: readonly SheetNesting[], lumber: LumberResult, hw: HardwareEstimate, cutList?: CutList): ShoppingList {
  const sheetLines: SheetPurchase[] = sheets.map((n) => ({
    materialId: n.materialId,
    name: n.materialName,
    thickness: n.thickness,
    length: n.length,
    width: n.width,
    count: n.sheets.length,
    utilization: n.utilization,
    unplaced: n.unplaced.length,
  }));
  const lumberLines: LumberPurchase[] = lumber.plans.map((p) => ({
    materialId: p.materialId,
    name: p.materialName,
    thickness: p.thickness,
    width: p.width,
    stock: p.stock,
    boards: p.boards.length,
    boardFeet: p.boardFeet,
    tooLong: p.tooLong.length,
  }));
  const byMat = new Map<Id, { materialId: Id; name: string; boards: number; boardFeet: number }>();
  for (const l of lumberLines) {
    const m = byMat.get(l.materialId) ?? { materialId: l.materialId, name: l.name, boards: 0, boardFeet: 0 };
    m.boards += l.boards;
    m.boardFeet += l.boardFeet;
    byMat.set(l.materialId, m);
  }
  // A glue-up piece that's too long counts its part once.
  const tooLongParts = new Set(lumber.plans.flatMap((p) => p.tooLong.map((t) => t.part.key)));
  return {
    sheets: sheetLines,
    lumber: lumberLines,
    lumberByMaterial: [...byMat.values()],
    boardFeet: lumberLines.reduce((s, l) => s + l.boardFeet, 0),
    byLength: cutList ? linearPurchases([...cutList.lumber, ...cutList.sheetGoods]) : [],
    hardware: hw.hardware,
    edgeBanding: hw.edgeBanding,
    unplacedParts: sheetLines.reduce((s, l) => s + l.unplaced, 0) + tooLongParts.size,
  };
}
