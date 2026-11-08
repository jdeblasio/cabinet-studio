/**
 * The cut list: identical parts (same material, thickness, length and width; names may differ)
 * grouped into rows, sheet goods separate from lumber.
 */
import type { PartRole, RunResult } from '../derived';
import type { Id, Material, Project } from '../model';
import { snap, type Ticks } from '../units';
import { fitsSheet, usableRect } from './guillotine';
import type { CutListOptions, LumberOptions, SheetOptions } from './options';
import { boardFeet, collectParts, ownerLabels, ownerOf, type PartOwner, type PartRef } from './parts';

/** 'length': the part's length must run with the grain. 'any': no grain to follow (the part may rotate). */
export type GrainNote = 'length' | 'any';

/** Something worth telling the builder about a row. Format with `describeRowNote`. */
export type RowNote =
  /** The part's thickness differs from its material's (e.g. a countertop with its own thickness). */
  | { kind: 'thicknessMismatch'; materialThickness: Ticks }
  /** Wider than one board: glue up from `boards` boards, each ripped to `boardWidth` and cut to `boardLength`. */
  | { kind: 'glueUp'; boards: number; boardWidth: Ticks; boardLength: Ticks }
  /** Doesn't fit the material's sheet (after trim). `fitsAcrossGrain`: it would fit turned 90°. */
  | { kind: 'exceedsSheet'; sheetLength: Ticks; sheetWidth: Ticks; fitsAcrossGrain: boolean }
  /** Longer than the longest stock board (after end trim). */
  | { kind: 'tooLong'; stockLength: Ticks; usable: Ticks }
  /** Lumber with no stock lengths to cut from. */
  | { kind: 'noStock' }
  /** Sheet material without a sheet size. */
  | { kind: 'noSheetSize' }
  /** The part's material is not in the project. */
  | { kind: 'missingMaterial' };

export interface CutListRow {
  /** Short reference (A, B, … Z, AA, …) shown on sheet layouts too. */
  label: string;
  materialId: Id;
  qty: number;
  length: Ticks;
  width: Ticks;
  thickness: Ticks;
  /** Distinct part names, first seen first. */
  names: string[];
  roles: PartRole[];
  /** Distinct boxes / spans / tiers the parts belong to. */
  owners: PartOwner[];
  parts: PartRef[];
  grain: GrainNote;
  /** Bought by length (moldings): listed as linear length to buy, not ripped or packed onto boards. */
  byLength: boolean;
  notes: RowNote[];
  /** Distinct notes carried by the parts themselves (e.g. "+1/4\" each end into dados"). */
  partNotes: string[];
}

export interface CutListGroup {
  materialId: Id;
  /** Material name, or the id when the material is missing. */
  name: string;
  kind: 'sheet' | 'lumber' | 'missing';
  material?: Material;
  rows: CutListRow[];
  /** Number of parts. */
  parts: number;
  /** Total face area of the parts (square ticks). */
  area: number;
  /** Total length of the parts. */
  linear: Ticks;
  /** Net board feet of the parts (finished sizes; moldings excluded). */
  boardFeet: number;
}

/** Roles bought by length rather than cut from boards. Their bounding box is a profile, so thickness isn't checked. */
export const BY_LENGTH_ROLES: ReadonlySet<PartRole> = new Set<PartRole>(['molding']);

export interface CutList {
  sheetGoods: CutListGroup[];
  lumber: CutListGroup[];
  /** Parts whose material is not in the project. */
  unknown: CutListGroup[];
  totals: { parts: number; rows: number; sheetArea: number; lumberLength: Ticks; boardFeet: number };
}

/** Row labels: A … Z, AA … AZ, BA … */
export function rowLabel(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** How a lumber part wider than `maxBoardWidth` is glued up, or null if one board will do. */
export function glueUpPlan(width: Ticks, length: Ticks, opts: LumberOptions, grid: Ticks): { boards: number; boardWidth: Ticks; boardLength: Ticks } | null {
  const max = opts.maxBoardWidth;
  if (!(max > 0) || width <= max) return null;
  const total = width + opts.glueUpAllowance;
  let boards = Math.max(2, Math.ceil(total / max));
  let boardWidth = snap(Math.ceil(total / boards), grid, 'up');
  while (boardWidth > max && boards < 1000) {
    boards++;
    boardWidth = snap(Math.ceil(total / boards), grid, 'up');
  }
  return { boards, boardWidth, boardLength: length + opts.glueUpAllowance };
}

/** Whether a sheet part may rotate on this material. */
export const canRotateOn = (m: Material, opts: SheetOptions): boolean => !(opts.respectGrain && m.sheet?.grain === 'length');

/** The `exceedsSheet` / `noSheetSize` note for a sheet part, or null if it fits. */
export function sheetFitNote(m: Material, length: Ticks, width: Ticks, opts: SheetOptions): RowNote | null {
  if (!m.sheet) return { kind: 'noSheetSize' };
  const area = usableRect({ length: m.sheet.length, width: m.sheet.width, kerf: opts.kerf, trim: opts.trim });
  const rot = canRotateOn(m, opts);
  if (area && fitsSheet({ w: length, h: width, canRotate: rot }, area)) return null;
  const across = !rot && !!area && fitsSheet({ w: length, h: width, canRotate: true }, area);
  return { kind: 'exceedsSheet', sheetLength: m.sheet.length, sheetWidth: m.sheet.width, fitsAcrossGrain: across };
}

/** Longest usable piece from the stock lengths (after trimming both ends). */
export function maxLumberLength(opts: LumberOptions): Ticks {
  const longest = Math.max(0, ...opts.stockLengths);
  return Math.max(0, longest - 2 * opts.endTrim);
}

/** The `tooLong` / `noStock` note for a lumber piece of `length`, or null if it fits a stock board. */
export function lumberFitNote(length: Ticks, opts: LumberOptions): RowNote | null {
  if (opts.stockLengths.length === 0) return { kind: 'noStock' };
  const usable = maxLumberLength(opts);
  return length > usable ? { kind: 'tooLong', stockLength: Math.max(...opts.stockLengths), usable } : null;
}

/** Group parts into cut list rows. Pure and deterministic. */
export function buildCutList(project: Project, results: readonly RunResult[], options: CutListOptions): CutList {
  const parts = collectParts(results);
  const labels = ownerLabels(project);
  const grid = project.units.grid;
  const matIndex = new Map(project.materials.map((m, i) => [m.id, i] as const));

  const groups = new Map<Id, Map<string, PartRef[]>>();
  for (const p of parts) {
    let g = groups.get(p.materialId);
    if (!g) groups.set(p.materialId, (g = new Map()));
    const key = `${p.thickness}|${p.length}|${p.width}${BY_LENGTH_ROLES.has(p.role) ? '|by-length' : ''}`;
    const list = g.get(key);
    if (list) list.push(p);
    else g.set(key, [p]);
  }

  const out: CutListGroup[] = [];
  for (const [materialId, rowsByKey] of groups) {
    const material = project.materials.find((m) => m.id === materialId);
    const kind: CutListGroup['kind'] = !material ? 'missing' : material.kind;
    const rows: CutListRow[] = [];
    for (const list of rowsByKey.values()) {
      const first = list[0]!;
      const byLength = BY_LENGTH_ROLES.has(first.role);
      const notes: RowNote[] = [];
      if (!material) notes.push({ kind: 'missingMaterial' });
      else if (!byLength) {
        if (first.thickness !== material.thickness) notes.push({ kind: 'thicknessMismatch', materialThickness: material.thickness });
        if (material.kind === 'sheet') {
          const n = sheetFitNote(material, first.length, first.width, options.sheet);
          if (n) notes.push(n);
        } else {
          const g = glueUpPlan(first.width, first.length, options.lumber, grid);
          if (g) notes.push({ kind: 'glueUp', ...g });
          const n = lumberFitNote(g ? g.boardLength : first.length, options.lumber);
          if (n) notes.push(n);
        }
      }
      const owners = new Map<string, PartOwner>();
      for (const p of list) owners.set(`${p.runId}:${p.ownerId}`, ownerOf(labels, p));
      rows.push({
        label: '',
        materialId,
        qty: list.length,
        length: first.length,
        width: first.width,
        thickness: first.thickness,
        names: [...new Set(list.map((p) => p.name))],
        roles: [...new Set(list.map((p) => p.role))],
        owners: [...owners.values()],
        parts: list,
        grain: material && (material.kind === 'lumber' || !canRotateOn(material, options.sheet)) ? 'length' : 'any',
        byLength,
        notes,
        partNotes: [...new Set(list.flatMap((p) => (p.note ? [p.note] : [])))],
      });
    }
    rows.sort((a, b) => b.thickness - a.thickness || b.length - a.length || b.width - a.width);
    let area = 0;
    let linear = 0;
    let bf = 0;
    for (const r of rows) {
      area += r.qty * r.length * r.width;
      linear += r.qty * r.length;
      if (!r.byLength) bf += r.qty * boardFeet(r.thickness, r.width, r.length);
    }
    const count = rows.reduce((n, r) => n + r.qty, 0);
    out.push({ materialId, name: material?.name ?? materialId, kind, ...(material ? { material } : {}), rows, parts: count, area, linear, boardFeet: bf });
  }

  // Materials in library order, missing materials last (by id).
  out.sort((a, b) => (matIndex.get(a.materialId) ?? Infinity) - (matIndex.get(b.materialId) ?? Infinity) || (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0));
  const sheetGoods = out.filter((g) => g.kind === 'sheet');
  const lumber = out.filter((g) => g.kind === 'lumber');
  const unknown = out.filter((g) => g.kind === 'missing');
  let i = 0;
  for (const g of [...sheetGoods, ...lumber, ...unknown]) for (const r of g.rows) r.label = rowLabel(i++);

  const all = [...sheetGoods, ...lumber, ...unknown];
  return {
    sheetGoods,
    lumber,
    unknown,
    totals: {
      parts: all.reduce((n, g) => n + g.parts, 0),
      rows: all.reduce((n, g) => n + g.rows.length, 0),
      sheetArea: sheetGoods.reduce((n, g) => n + g.area, 0),
      lumberLength: lumber.reduce((n, g) => n + g.linear, 0),
      boardFeet: lumber.reduce((n, g) => n + g.boardFeet, 0),
    },
  };
}

/** Human-readable text for a row note. */
export function describeRowNote(note: RowNote, fmt: (t: Ticks) => string): string {
  switch (note.kind) {
    case 'thicknessMismatch':
      return `Material is ${fmt(note.materialThickness)} thick`;
    case 'glueUp':
      return `Glue-up: ${note.boards} boards ${fmt(note.boardWidth)} wide × ${fmt(note.boardLength)}`;
    case 'exceedsSheet':
      return `Doesn't fit a ${fmt(note.sheetLength)} × ${fmt(note.sheetWidth)} sheet${note.fitsAcrossGrain ? ' with the grain (fits across it)' : ''}`;
    case 'tooLong':
      return `Longer than the longest stock board (${fmt(note.stockLength)}, ${fmt(note.usable)} usable)`;
    case 'noStock':
      return 'No stock lengths set';
    case 'noSheetSize':
      return 'Material has no sheet size';
    case 'missingMaterial':
      return 'Material not found';
  }
}
