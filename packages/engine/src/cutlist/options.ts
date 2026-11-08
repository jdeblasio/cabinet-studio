/**
 * Options for the cut list, sheet nesting and lumber optimizer.
 * Not persisted in the project yet; callers keep them and pass them in.
 */
import type { DeepPartial } from '../model';
import { mergeSettings } from '../settings';
import { inches, type Ticks } from '../units';

/** Strip removed from each sheet edge before parts are laid out (kerf included). Sheet coordinates: x runs along the sheet length. */
export interface EdgeTrim {
  /** x = 0 end of the sheet. */
  left: Ticks;
  /** x = length end. */
  right: Ticks;
  /** y = 0 long edge. */
  top: Ticks;
  /** y = width long edge. */
  bottom: Ticks;
}

export interface SheetOptions {
  /** Saw kerf. */
  kerf: Ticks;
  trim: EdgeTrim;
  /** On sheets with grain, keep each part's length along the sheet length. Off: parts may rotate (paint grade). */
  respectGrain: boolean;
}

export interface LumberOptions {
  /** Saw kerf for crosscuts. */
  kerf: Ticks;
  /** Cut off each end of a board before parts are cut (checks, snipe, out-of-square ends; kerf included). */
  endTrim: Ticks;
  /** Board lengths to buy from. Order doesn't matter. */
  stockLengths: Ticks[];
  /** Widest single board. Wider parts are glued up from several boards. */
  maxBoardWidth: Ticks;
  /** Added to a glue-up's width (jointing, final rip) and length (squaring the ends after glue-up). */
  glueUpAllowance: Ticks;
}

export interface CutListOptions {
  sheet: SheetOptions;
  lumber: LumberOptions;
}

export const DEFAULT_CUTLIST_OPTIONS: CutListOptions = {
  sheet: {
    kerf: inches(1 / 8),
    trim: { left: inches(1 / 4), right: inches(1 / 4), top: inches(1 / 4), bottom: inches(1 / 4) },
    respectGrain: true,
  },
  lumber: {
    kerf: inches(1 / 8),
    endTrim: inches(1 / 2),
    stockLengths: [inches(96), inches(120), inches(144)],
    maxBoardWidth: inches(11.25),
    glueUpAllowance: inches(1 / 2),
  },
};

/** Fill in missing options from the defaults; negative values are clamped to 0. */
export function resolveCutListOptions(patch?: DeepPartial<CutListOptions>): CutListOptions {
  const o = mergeSettings(DEFAULT_CUTLIST_OPTIONS, patch);
  const nn = (t: Ticks) => (Number.isFinite(t) && t > 0 ? Math.round(t) : 0);
  const stock = [...new Set(o.lumber.stockLengths.map(nn).filter((t) => t > 0))].sort((a, b) => a - b);
  return {
    sheet: {
      kerf: nn(o.sheet.kerf),
      trim: { left: nn(o.sheet.trim.left), right: nn(o.sheet.trim.right), top: nn(o.sheet.trim.top), bottom: nn(o.sheet.trim.bottom) },
      respectGrain: o.sheet.respectGrain,
    },
    lumber: {
      kerf: nn(o.lumber.kerf),
      endTrim: nn(o.lumber.endTrim),
      stockLengths: stock,
      maxBoardWidth: nn(o.lumber.maxBoardWidth),
      glueUpAllowance: nn(o.lumber.glueUpAllowance),
    },
  };
}
