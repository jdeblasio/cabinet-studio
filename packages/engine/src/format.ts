/**
 * Parsing and formatting lengths for display and input.
 */
import type { Ticks, UnitSystem } from './units';
import { DEFAULT_GRID, TICKS_PER_INCH, TICKS_PER_MM, toMm } from './units';

export interface FormatOptions {
  /** Grid to round to for display. Defaults to 1/32" (imperial) or 0.5 mm (metric). */
  grid?: Ticks;
  /** Imperial only: 'inches' → 30 1/2", 'feetInches' → 2' 6 1/2". Default 'inches'. */
  imperialStyle?: 'inches' | 'feetInches';
  /** Append units (", mm). Default true. The 'feetInches' style always shows unit marks. */
  showUnits?: boolean;
  /** Prefix "≈" when rounding to the grid changed the value. Default false. */
  markApproximate?: boolean;
}

const TICKS_PER_FOOT = TICKS_PER_INCH * 12;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Nearest-multiple rounding that is symmetric around zero (-x rounds like x). */
function roundToGrid(absTicks: number, grid: Ticks): number {
  if (!(grid > 0)) return Math.round(absTicks);
  return Math.round(absTicks / grid) * grid;
}

/** True if `grid` is exactly 1/2^n inch (n >= 0). */
function isBinaryInchGrid(grid: Ticks): boolean {
  if (!(grid > 0) || !Number.isInteger(grid) || TICKS_PER_INCH % grid !== 0) return false;
  const q = TICKS_PER_INCH / grid;
  return (q & (q - 1)) === 0;
}

/** Decimal string with at most `digits` decimals, trailing zeros trimmed. */
function trimmedDecimal(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

/** Non-negative inches (as ticks) → `30 1/2`, `23/32`, `0`, or decimal fallback. */
function inchesBody(absTicks: number, binaryGrid: boolean): string {
  if (!binaryGrid) return trimmedDecimal(absTicks / TICKS_PER_INCH, 3);
  const whole = Math.floor(absTicks / TICKS_PER_INCH);
  const rem = absTicks - whole * TICKS_PER_INCH;
  const parts: string[] = [];
  if (whole > 0 || rem === 0) parts.push(String(whole));
  if (rem > 0) {
    const d = gcd(rem, TICKS_PER_INCH);
    parts.push(`${rem / d}/${TICKS_PER_INCH / d}`);
  }
  return parts.join(' ');
}

/** Format a length in the given unit system. */
export function formatLength(t: Ticks, system: UnitSystem, opts: FormatOptions = {}): string {
  const grid = opts.grid ?? DEFAULT_GRID[system];
  const showUnits = opts.showUnits ?? true;
  const abs = roundToGrid(Math.abs(t), grid);
  const negative = t < 0 && abs !== 0;
  const approx = opts.markApproximate === true && abs !== Math.abs(t);
  const prefix = (approx ? '≈' : '') + (negative ? '-' : '');

  if (system === 'metric') {
    const body = trimmedDecimal(toMm(abs), 6);
    return `${prefix}${body}${showUnits ? ' mm' : ''}`;
  }

  const binary = isBinaryInchGrid(grid);
  if (opts.imperialStyle === 'feetInches') {
    const feet = Math.floor(abs / TICKS_PER_FOOT);
    const rest = abs - feet * TICKS_PER_FOOT;
    const inchPart = `${inchesBody(rest, binary)}"`;
    return `${prefix}${feet > 0 ? `${feet}' ` : ''}${inchPart}`;
  }
  return `${prefix}${inchesBody(abs, binary)}${showUnits ? '"' : ''}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'num'; text: string }
  | { kind: 'unit'; unit: Unit }
  | { kind: 'slash' }
  | { kind: 'dash' }
  | { kind: 'space' };

type Unit = 'ft' | 'in' | 'mm' | 'cm' | 'm';

const UNIT_WORDS: Record<string, Unit> = {
  ft: 'ft',
  foot: 'ft',
  feet: 'ft',
  in: 'in',
  inch: 'in',
  inches: 'in',
  mm: 'mm',
  cm: 'cm',
  m: 'm',
};

const TICKS_PER_UNIT: Record<Unit, number> = {
  ft: TICKS_PER_FOOT,
  in: TICKS_PER_INCH,
  mm: TICKS_PER_MM,
  cm: TICKS_PER_MM * 10,
  m: TICKS_PER_MM * 1000,
};

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isLetter = (c: string): boolean => c >= 'a' && c <= 'z';
const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ';

/** Split a single term (no top-level +/-) into tokens; null on an unknown character or word. */
function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (isSpace(c)) {
      while (i < src.length && isSpace(src.charAt(i))) i++;
      tokens.push({ kind: 'space' });
    } else if (isDigit(c) || c === '.') {
      const start = i;
      while (i < src.length && (isDigit(src.charAt(i)) || src.charAt(i) === '.')) i++;
      const text = src.slice(start, i);
      if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
      tokens.push({ kind: 'num', text });
    } else if (isLetter(c)) {
      const start = i;
      while (i < src.length && isLetter(src.charAt(i))) i++;
      const unit = UNIT_WORDS[src.slice(start, i)];
      if (!unit) return null;
      tokens.push({ kind: 'unit', unit });
    } else if (c === "'" || c === '’' || c === '′') {
      tokens.push({ kind: 'unit', unit: 'ft' });
      i++;
    } else if (c === '"' || c === '”' || c === '″') {
      tokens.push({ kind: 'unit', unit: 'in' });
      i++;
    } else if (c === '/') {
      tokens.push({ kind: 'slash' });
      i++;
    } else if (c === '-') {
      tokens.push({ kind: 'dash' });
      i++;
    } else {
      return null;
    }
  }
  return tokens;
}

/**
 * Split input into signed terms. A `+` or `-` is an operator only when whitespace
 * surrounds it, so `30-1/2` stays a mixed number and `-3/4` stays negative.
 */
function splitTerms(src: string): { sign: 1 | -1; text: string }[] {
  const terms: { sign: 1 | -1; text: string }[] = [];
  let sign: 1 | -1 = 1;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charAt(i);
    if ((c === '+' || c === '-') && i > 0 && isSpace(src.charAt(i - 1)) && i + 1 < src.length && isSpace(src.charAt(i + 1))) {
      terms.push({ sign, text: src.slice(start, i) });
      sign = c === '+' ? 1 : -1;
      start = i + 1;
    }
  }
  terms.push({ sign, text: src.slice(start) });
  return terms;
}

class TermParser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly defaultUnit: Unit,
  ) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private skipSpace(): void {
    while (this.peek()?.kind === 'space') this.pos++;
  }

  private numAt(offset: number): string | null {
    const tok = this.peek(offset);
    return tok?.kind === 'num' ? tok.text : null;
  }

  /** quantity := num | num '/' num | int (space|'-') int '/' num. Returns a value in its own unit. */
  private quantity(): number | null {
    const first = this.numAt(0);
    if (first === null) return null;
    this.pos++;

    if (this.peek()?.kind === 'slash') {
      const den = this.numAt(1);
      if (den === null) return null;
      this.pos += 2;
      return Number(den) === 0 ? null : Number(first) / Number(den);
    }

    // Mixed number: "30 1/2" or "30-1/2".
    const sep = this.peek()?.kind;
    if ((sep === 'space' || sep === 'dash') && /^\d+$/.test(first) && this.peek(2)?.kind === 'slash') {
      const num = this.numAt(1);
      const den = this.numAt(3);
      if (num !== null && den !== null && /^\d+$/.test(num)) {
        if (Number(den) === 0) return null;
        this.pos += 4;
        return Number(first) + Number(num) / Number(den);
      }
    }
    return Number(first);
  }

  /** Parse the whole term to ticks (unrounded), or null. */
  parse(): number | null {
    let negative = false;
    if (this.peek()?.kind === 'dash') {
      negative = true;
      this.pos++;
    }

    let total = 0;
    let first = true;
    let prevUnit: Unit | null = null;
    for (;;) {
      this.skipSpace();
      const value = this.quantity();
      if (value === null) return null;
      this.skipSpace();

      let unit: Unit;
      const tok = this.peek();
      if (tok?.kind === 'unit') {
        unit = tok.unit;
        this.pos++;
        // Feet may only lead; metric units stand alone; inches may follow feet or lead.
        if (!first && unit !== 'in') return null;
      } else if (first) {
        unit = this.defaultUnit;
      } else {
        unit = 'in'; // 2' 6  → 2 feet 6 inches
      }
      total += value * TICKS_PER_UNIT[unit];
      prevUnit = unit;
      first = false;

      if (unit !== 'ft') break;
      // After feet: optional "-" or space, then an inches segment, or end of input.
      this.skipSpace();
      if (this.peek() === undefined) break;
      if (this.peek()?.kind === 'dash') this.pos++;
      this.skipSpace();
    }

    this.skipSpace();
    if (this.peek() !== undefined || prevUnit === null) return null;
    return negative ? -total : total;
  }
}

/**
 * Parse user input into ticks (rounded to the nearest tick, not snapped to a grid).
 * Bare numbers are interpreted in `system`'s default unit (inches or mm).
 * Returns null if the input can't be parsed.
 */
export function parseLength(input: string, system: UnitSystem): Ticks | null {
  const src = input.trim().toLowerCase();
  if (src === '') return null;
  const defaultUnit: Unit = system === 'imperial' ? 'in' : 'mm';

  let total = 0;
  for (const term of splitTerms(src)) {
    const tokens = tokenize(term.text.trim());
    if (tokens === null || tokens.length === 0) return null;
    const value = new TermParser(tokens, defaultUnit).parse();
    if (value === null || !Number.isFinite(value)) return null;
    total += term.sign * value;
  }
  return Math.round(total) + 0; // + 0 normalizes -0
}
