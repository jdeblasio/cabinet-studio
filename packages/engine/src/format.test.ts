import { describe, expect, it } from 'vitest';
import type { FormatOptions } from './format';
import { formatLength, parseLength } from './format';
import type { UnitSystem } from './units';
import { inches, mm } from './units';

const IN = 8128;
const FT = 12 * IN;

describe('parseLength', () => {
  const imperialCases: [string, number | null][] = [
    // bare numbers
    ['30', 30 * IN],
    ['30.5', inches(30.5)],
    ['.75', inches(0.75)],
    ['0', 0],
    ['  30  ', 30 * IN],
    // fractions and mixed numbers
    ['3/4', inches(0.75)],
    ['30 1/2', inches(30.5)],
    ['30-1/2', inches(30.5)],
    ['30   1/2', inches(30.5)],
    ['30 1/2"', inches(30.5)],
    ['30 1/2 in', inches(30.5)],
    ['30 1/2 inches', inches(30.5)],
    ['30 1/2 INCH', inches(30.5)],
    ['30in', 30 * IN],
    ['30"', 30 * IN],
    ['3/4"', inches(0.75)],
    ['23/32', 23 * 254],
    ['1/64', 127],
    // feet
    ["2'", 2 * FT],
    ["2' 6\"", 2 * FT + 6 * IN],
    ["2'6", 2 * FT + 6 * IN],
    ["2'6\"", 2 * FT + 6 * IN],
    ['2ft 6in', 2 * FT + 6 * IN],
    ['2 FT 6 IN', 2 * FT + 6 * IN],
    ['2 feet', 2 * FT],
    ["2' 6 1/2\"", 2 * FT + inches(6.5)],
    ["2'-6 1/2\"", 2 * FT + inches(6.5)],
    ["2' 1/2\"", 2 * FT + inches(0.5)],
    ["8' 2 1/2\"", 8 * FT + inches(2.5)],
    ["1.5'", inches(18)],
    // metric suffixes valid in imperial too
    ['600mm', mm(600)],
    ['60 cm', mm(600)],
    ['0.6m', mm(600)],
    ['18.5 mm', mm(18.5)],
    ['0.1mm', 32],
    // negatives
    ['-3/4', -inches(0.75)],
    ['-30 1/2', -inches(30.5)],
    ['-30-1/2', -inches(30.5)],
    ["-2' 6\"", -(2 * FT + 6 * IN)],
    ['-18mm', -mm(18)],
    // addition / subtraction
    ['30 1/2 + 3/4', inches(31.25)],
    ['36" - 1 1/2"', inches(34.5)],
    ['600mm + 1"', mm(600) + IN],
    ['10 + 5 + 2', 17 * IN],
    ['10 - 5 - 2', 3 * IN],
    ["2' - 6\"", 2 * FT - 6 * IN],
    ['5 - -1', 6 * IN],
    ['5 + -1', 4 * IN],
    ['30-1/2 + 1', inches(31.5)],
    // rounds to nearest tick, never to a grid
    ['0.00006', 0],
    ['0.00007', 1],
    ['1/3', Math.round(IN / 3)],
    // null cases
    ['', null],
    ['   ', null],
    ['abc', null],
    ['12x', null],
    ['x12', null],
    ['1/0', null],
    ['1 1/0', null],
    ['3/4/5', null],
    ['30 +', null],
    ['30 -', null],
    ['+ 30', null],
    ['30 + + 5', null],
    ['1.2.3', null],
    ['.', null],
    ['3/', null],
    ['/4', null],
    ['30.5 1/2', null],
    ['30 12', null],
    ["2' 6mm", null],
    ["2'6'", null],
    ['6in 2ft', null],
    ['5mm 3mm', null],
    ['1e3', null],
    ['--5', null],
    ['30 -1/2', null],
    ['30 in 1/2', null],
    ["2'-", null],
    ['30 1/2 foo', null],
  ];

  it.each(imperialCases)('imperial %j → %j', (input, expected) => {
    expect(parseLength(input, 'imperial')).toBe(expected);
  });

  const metricCases: [string, number | null][] = [
    ['600', mm(600)],
    ['762.5', mm(762.5)],
    ['.5', mm(0.5)],
    ['600mm', mm(600)],
    ['60cm', mm(600)],
    ['0.6 M', mm(600)],
    ['24"', 24 * IN],
    ['3/4"', inches(0.75)],
    ["2'", 2 * FT],
    ['1 1/2 in', inches(1.5)],
    ['600 + 1"', mm(600) + IN],
    ['600 - 50', mm(550)],
    ['-18', -mm(18)],
    ['1/2', mm(0.5)],
    ['', null],
    ['12x', null],
  ];

  it.each(metricCases)('metric %j → %j', (input, expected) => {
    expect(parseLength(input, 'metric')).toBe(expected);
  });

  it('never returns -0', () => {
    expect(Object.is(parseLength('-0', 'imperial'), 0)).toBe(true);
    expect(Object.is(parseLength('-0.00001', 'imperial'), 0)).toBe(true);
  });

  it('always returns integers', () => {
    for (const s of ['1/3', '0.123456', '2/3 + 1/7', '1.0001mm']) {
      expect(Number.isInteger(parseLength(s, 'imperial'))).toBe(true);
    }
  });
});

describe('formatLength', () => {
  type Case = [label: string, ticks: number, system: UnitSystem, opts: FormatOptions, expected: string];
  const cases: Case[] = [
    // imperial, inches style
    ['mixed', inches(30.5), 'imperial', {}, '30 1/2"'],
    ['fraction only', 23 * 254, 'imperial', {}, '23/32"'],
    ['zero', 0, 'imperial', {}, '0"'],
    ['whole', inches(96), 'imperial', {}, '96"'],
    ['negative mixed', -inches(1.5), 'imperial', {}, '-1 1/2"'],
    ['negative fraction', -254, 'imperial', {}, '-1/32"'],
    ['smallest grid step', 254, 'imperial', {}, '1/32"'],
    ['reduces 2/32', 508, 'imperial', {}, '1/16"'],
    ['reduces 16/32', inches(0.5), 'imperial', {}, '1/2"'],
    ['rounds up to whole', inches(1) - 10, 'imperial', {}, '1"'],
    ['rounds down', 100, 'imperial', {}, '0"'],
    ['rounds nearest up', 128, 'imperial', {}, '1/32"'],
    ['rounds to -0 prints 0', -100, 'imperial', {}, '0"'],
    ['negative ties symmetric', -127, 'imperial', {}, '-1/32"'],
    ['coarser grid 1/8"', inches(1 / 16), 'imperial', { grid: inches(1 / 8) }, '1/8"'],
    ['grid 1/4"', inches(5 / 16), 'imperial', { grid: inches(1 / 4) }, '1/4"'],
    ['grid 1" ', inches(30.4), 'imperial', { grid: inches(1) }, '30"'],
    ['grid 1/64"', 127, 'imperial', { grid: 127 }, '1/64"'],
    ['showUnits false', inches(30.5), 'imperial', { showUnits: false }, '30 1/2'],
    ['showUnits false fraction', 23 * 254, 'imperial', { showUnits: false }, '23/32'],
    ['showUnits false negative', -inches(0.5), 'imperial', { showUnits: false }, '-1/2'],
    // imperial fallback to decimals for non-1/2^n grids
    ['metric grid → decimal', mm(18), 'imperial', { grid: mm(0.5) }, '0.709"'],
    ['metric grid trims zeros', inches(2.5), 'imperial', { grid: mm(0.5) }, '2.5"'],
    ['metric grid whole', inches(3), 'imperial', { grid: mm(0.1) }, '3"'],
    ['metric grid no units', mm(18), 'imperial', { grid: mm(0.5), showUnits: false }, '0.709'],
    ['metric grid negative', -mm(18), 'imperial', { grid: mm(0.5) }, '-0.709"'],
    ['odd tick grid', 1, 'imperial', { grid: 1 }, '0"'],
    ['zero grid → no snapping', 254, 'imperial', { grid: 0 }, '0.031"'],
    // feetInches
    ['ft+in+frac', 8 * FT + inches(2.5), 'imperial', { imperialStyle: 'feetInches' }, `8' 2 1/2"`],
    ['ft exact', 2 * FT, 'imperial', { imperialStyle: 'feetInches' }, `2' 0"`],
    ['under a foot', inches(11.5), 'imperial', { imperialStyle: 'feetInches' }, '11 1/2"'],
    ['zero', 0, 'imperial', { imperialStyle: 'feetInches' }, '0"'],
    ['exactly 12"', FT, 'imperial', { imperialStyle: 'feetInches' }, `1' 0"`],
    ['rounds up across foot', FT - 10, 'imperial', { imperialStyle: 'feetInches' }, `1' 0"`],
    ['fraction only', 23 * 254, 'imperial', { imperialStyle: 'feetInches' }, '23/32"'],
    ['ft + fraction only', FT + 23 * 254, 'imperial', { imperialStyle: 'feetInches' }, `1' 23/32"`],
    ['negative', -(2 * FT + inches(6.5)), 'imperial', { imperialStyle: 'feetInches' }, `-2' 6 1/2"`],
    ['showUnits false ignored', 2 * FT, 'imperial', { imperialStyle: 'feetInches', showUnits: false }, `2' 0"`],
    ['decimal fallback', 2 * FT + mm(18), 'imperial', { imperialStyle: 'feetInches', grid: mm(0.5) }, `2' 0.705"`],
    // metric
    ['whole mm', mm(762), 'metric', {}, '762 mm'],
    ['half mm', mm(762.5), 'metric', {}, '762.5 mm'],
    ['zero', 0, 'metric', {}, '0 mm'],
    ['negative', -mm(18), 'metric', {}, '-18 mm'],
    ['rounds to 0.5', mm(18.3), 'metric', {}, '18.5 mm'],
    ['rounds to 0.5 down', mm(18.2), 'metric', {}, '18 mm'],
    ['grid 0.1', mm(18.3), 'metric', { grid: mm(0.1) }, '18.3 mm'],
    ['grid 0.1 whole', mm(18), 'metric', { grid: mm(0.1) }, '18 mm'],
    ['grid 1', mm(18.6), 'metric', { grid: mm(1) }, '19 mm'],
    ['showUnits false', mm(762.5), 'metric', { showUnits: false }, '762.5'],
    ['showUnits false whole', mm(762), 'metric', { showUnits: false }, '762'],
    ['imperialStyle ignored', mm(762), 'metric', { imperialStyle: 'feetInches' }, '762 mm'],
    ['imperial grid in metric', inches(1), 'metric', { grid: 254 }, '25.4 mm'],
    ['negative tiny rounds to 0', -10, 'metric', {}, '0 mm'],
    // markApproximate
    ['approx imperial', mm(18), 'imperial', { markApproximate: true }, '≈23/32"'],
    ['approx exact → no mark', inches(1.5), 'imperial', { markApproximate: true }, '1 1/2"'],
    ['approx negative', -mm(18), 'imperial', { markApproximate: true }, '≈-23/32"'],
    ['approx metric', inches(1), 'metric', { markApproximate: true }, '≈25.5 mm'],
    ['approx metric exact', mm(18), 'metric', { markApproximate: true }, '18 mm'],
    ['approx no units', mm(18), 'imperial', { markApproximate: true, showUnits: false }, '≈23/32'],
    ['approx feetInches', FT + mm(18), 'imperial', { markApproximate: true, imperialStyle: 'feetInches' }, `≈1' 23/32"`],
    ['approx false explicit', mm(18), 'imperial', { markApproximate: false }, '23/32"'],
    ['approx default off', mm(18), 'imperial', {}, '23/32"'],
    ['approx rounds to zero negative', -10, 'imperial', { markApproximate: true }, '≈0"'],
  ];

  it.each(cases)('%s', (_label, ticks, system, opts, expected) => {
    expect(formatLength(ticks, system, opts)).toBe(expected);
  });

  it('round-trips grid-aligned imperial values through parseLength', () => {
    for (let n = -200; n <= 3200; n += 7) {
      const t = n * 254;
      expect(parseLength(formatLength(t, 'imperial'), 'imperial')).toBe(t);
      expect(parseLength(formatLength(t, 'imperial', { imperialStyle: 'feetInches' }), 'imperial')).toBe(t);
    }
  });

  it('round-trips grid-aligned metric values through parseLength', () => {
    for (let n = -50; n <= 5000; n += 13) {
      const t = n * 160;
      expect(parseLength(formatLength(t, 'metric'), 'metric')).toBe(t);
    }
  });
});
