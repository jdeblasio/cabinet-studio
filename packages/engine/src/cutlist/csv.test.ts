import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../defaults';
import { deriveProject } from '../derive/index';
import { formatLength } from '../format';
import { inches } from '../units';
import { buildCutList } from './cutlist';
import { CSV_COLUMNS, csvField, cutListCsv } from './csv';
import { DEFAULT_CUTLIST_OPTIONS } from './options';
import { fakePart, fakeResult, projectWith } from './testing';

/** Minimal RFC 4180 parser, to check the output round-trips. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

describe('csvField', () => {
  it('quotes only when needed', () => {
    expect(csvField('Left side')).toBe('Left side');
    expect(csvField(3)).toBe('3');
    expect(csvField('30 1/2"')).toBe('"30 1/2"""');
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(' padded')).toBe('" padded"');
  });

  it('defuses spreadsheet formulas in text', () => {
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('@cmd')).toBe("'@cmd");
  });
});

describe('cutListCsv', () => {
  const p = createDefaultProject();
  const cl = buildCutList(p, deriveProject(p), DEFAULT_CUTLIST_OPTIONS);

  it('has a header and one line per row, CRLF terminated', () => {
    const csv = cutListCsv(cl);
    expect(csv.endsWith('\r\n')).toBe(true);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows.length - 1).toBe(cl.totals.rows);
    for (const r of rows) expect(r).toHaveLength(CSV_COLUMNS.length);
  });

  it('formats lengths in the requested units, or with a custom formatter', () => {
    const imperial = parseCsv(cutListCsv(cl, 'imperial'));
    const metric = parseCsv(cutListCsv(cl, 'metric'));
    const custom = parseCsv(cutListCsv(cl, (t) => (t / inches(1)).toFixed(3)));
    const first = cl.sheetGoods[0]!.rows[0]!;
    const f = (t: number, system: 'imperial' | 'metric') => formatLength(t, system);
    expect(imperial[1]!.slice(0, 7)).toEqual([first.label, 'Sheet', cl.sheetGoods[0]!.name, String(first.qty), f(first.length, 'imperial'), f(first.width, 'imperial'), '23/32"']);
    expect(metric[1]![4]).toBe(f(first.length, 'metric'));
    expect(metric[1]![4]).toMatch(/ mm$/);
    expect(custom[1]![6]).toBe('0.719');
  });

  it('lists names, owners and notes, including part notes', () => {
    const project = projectWith();
    const parts = [{ ...fakePart({ length: 20, width: 10, name: 'Top', ownerId: 'x' }), note: 'Cut +1/4" for dados' }, fakePart({ length: 20, width: 10, name: 'Bottom', ownerId: 'x' })];
    const rows = parseCsv(cutListCsv(buildCutList(project, [fakeResult(parts)], DEFAULT_CUTLIST_OPTIONS)));
    expect(rows[1]!.slice(8)).toEqual(['Top; Bottom', 'x', 'Cut +1/4" for dados']);
  });
});
