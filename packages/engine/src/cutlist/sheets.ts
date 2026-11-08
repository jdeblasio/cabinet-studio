/** Sheet nesting per sheet material, on top of the guillotine packer. */
import type { Id, Material } from '../model';
import type { Ticks } from '../units';
import type { CutListGroup } from './cutlist';
import { canRotateOn } from './cutlist';
import { nestGuillotine, usableRect, type NestCut, type NestItem, type NestRect } from './guillotine';
import type { EdgeTrim, SheetOptions } from './options';
import type { PartRef } from './parts';

export interface SheetPlacement extends NestRect {
  /** True when the part's length runs across the sheet (along y). */
  rotated: boolean;
  part: PartRef;
  /** Cut list row label. */
  label: string;
}

export interface SheetLayout {
  /** 0-based, fullest sheet first. */
  index: number;
  placements: SheetPlacement[];
  /** Waste pieces left after cutting (inside the trimmed area), largest first. */
  offcuts: NestRect[];
  /** Cut sequence, trims first. */
  cuts: NestCut[];
  partArea: number;
  /** Part area / full sheet area. */
  utilization: number;
}

export type UnplacedReason = 'too-long' | 'too-wide' | 'no-sheet-size';

export interface UnplacedPart {
  part: PartRef;
  label: string;
  reason: UnplacedReason;
  /** Would fit if turned across the grain. */
  fitsAcrossGrain: boolean;
}

export interface SheetNesting {
  materialId: Id;
  materialName: string;
  thickness: Ticks;
  /** Sheet size (0 × 0 when the material has none). */
  length: Ticks;
  width: Ticks;
  grain: 'length' | 'none';
  /** Whether parts were allowed to rotate. */
  rotation: boolean;
  kerf: Ticks;
  trim: EdgeTrim;
  /** Trimmed area parts may use, or null. */
  usable: NestRect | null;
  sheets: SheetLayout[];
  /** Parts that fit no sheet. Never dropped silently. */
  unplaced: UnplacedPart[];
  partArea: number;
  /** Part area / area of all sheets used. */
  utilization: number;
  strategy: string;
}

/** Nest one sheet material's cut list rows onto its sheets. */
export function nestSheetGroup(material: Material, group: CutListGroup, opts: SheetOptions): SheetNesting {
  const parts: { part: PartRef; label: string }[] = [];
  for (const row of group.rows) for (const p of row.parts) parts.push({ part: p, label: row.label });
  const base = {
    materialId: material.id,
    materialName: material.name,
    thickness: material.thickness,
    length: material.sheet?.length ?? 0,
    width: material.sheet?.width ?? 0,
    grain: material.sheet?.grain ?? 'none',
    rotation: canRotateOn(material, opts),
    kerf: opts.kerf,
    trim: opts.trim,
  } as const;
  if (!material.sheet) {
    return {
      ...base,
      usable: null,
      sheets: [],
      unplaced: parts.map((p) => ({ ...p, reason: 'no-sheet-size' as const, fitsAcrossGrain: false })),
      partArea: 0,
      utilization: 0,
      strategy: 'none',
    };
  }

  const spec = { length: material.sheet.length, width: material.sheet.width, kerf: opts.kerf, trim: opts.trim };
  const area = usableRect(spec);
  const rot = base.rotation;
  const items: NestItem[] = parts.map(({ part }) => ({ w: part.length, h: part.width, canRotate: rot }));
  const res = nestGuillotine(items, spec);
  const sheetArea = spec.length * spec.width;

  const sheets: SheetLayout[] = res.sheets.map((s, index) => ({
    index,
    placements: s.placements.map((pl) => {
      const src = parts[pl.item]!;
      return { x: pl.x, y: pl.y, w: pl.w, h: pl.h, rotated: pl.rotated, part: src.part, label: src.label };
    }),
    offcuts: s.offcuts,
    cuts: s.cuts,
    partArea: s.partArea,
    utilization: sheetArea > 0 ? s.partArea / sheetArea : 0,
  }));

  const unplaced: UnplacedPart[] = res.unplaced.map((i) => {
    const src = parts[i]!;
    const { length: l, width: w } = src.part;
    const aw = area?.w ?? 0;
    const ah = area?.h ?? 0;
    // Too long: the length (or, if it may rotate, the long side) is what doesn't fit.
    const tooLong = rot ? Math.max(l, w) > Math.max(aw, ah) : l > aw;
    const across = !rot && w <= aw && l <= ah;
    return { ...src, reason: tooLong ? 'too-long' : 'too-wide', fitsAcrossGrain: across };
  });

  const partArea = sheets.reduce((n, s) => n + s.partArea, 0);
  return {
    ...base,
    usable: area,
    sheets,
    unplaced,
    partArea,
    utilization: sheets.length > 0 ? partArea / (sheets.length * sheetArea) : 0,
    strategy: res.strategy,
  };
}
