/** CSV export of the cut list (RFC 4180: comma separated, CRLF, fields quoted when needed). */
import { formatLength } from '../format';
import type { UnitSystem, Ticks } from '../units';
import { describeRowNote, type CutList } from './cutlist';

/** A unit system (formatted with its default grid) or a custom length formatter. */
export type LengthFormat = UnitSystem | ((t: Ticks) => string);

/** Quote a CSV field if it contains a comma, quote, line break or edge whitespace. */
export function csvField(value: string | number): string {
  let s = String(value);
  // Don't let spreadsheet apps evaluate user text (box names) as formulas.
  if (/^[=+@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = ['Label', 'Type', 'Material', 'Qty', 'Length', 'Width', 'Thickness', 'Grain', 'Parts', 'Boxes', 'Notes'] as const;

/** The cut list as CSV text, one row per cut list row. */
export function cutListCsv(cutList: CutList, format: LengthFormat = 'imperial'): string {
  const fmt = typeof format === 'function' ? format : (t: Ticks) => formatLength(t, format);
  const lines = [CSV_COLUMNS.join(',')];
  const groups = [...cutList.sheetGoods, ...cutList.lumber, ...cutList.unknown];
  for (const g of groups) {
    const type = g.kind === 'sheet' ? 'Sheet' : g.kind === 'lumber' ? 'Lumber' : 'Unknown';
    for (const r of g.rows) {
      const cells = [
        r.label,
        type,
        g.name,
        r.qty,
        fmt(r.length),
        fmt(r.width),
        fmt(r.thickness),
        r.grain === 'length' ? 'Along length' : 'Any',
        r.names.join('; '),
        r.owners.map((o) => o.label).join('; '),
        [...(r.byLength ? ['Bought by length'] : []), ...r.partNotes, ...r.notes.map((n) => describeRowNote(n, fmt))].join('; '),
      ];
      lines.push(cells.map(csvField).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}
