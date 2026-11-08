import { describe, expect, it } from 'vitest';
import { inches } from '../units';
import { solveLine } from './solveLine';

const g = inches(1 / 32);
const fixed = (n: number) => ({ kind: 'fixed' as const, size: inches(n) });
const flex = (ratio = 1, min?: number, max?: number) => ({
  kind: 'flex' as const,
  ratio,
  ...(min !== undefined ? { min: inches(min) } : {}),
  ...(max !== undefined ? { max: inches(max) } : {}),
});

describe('solveLine', () => {
  it('returns all space as remainder with no items', () => {
    expect(solveLine(inches(10), [], g)).toEqual({ sizes: [], remainder: inches(10), overflow: 0 });
  });

  it('keeps fixed sizes and reports remainder', () => {
    const r = solveLine(inches(40), [fixed(12), fixed(18)], g);
    expect(r.sizes).toEqual([inches(12), inches(18)]);
    expect(r.remainder).toBe(inches(10));
    expect(r.overflow).toBe(0);
  });

  it('snaps fixed sizes to the grid', () => {
    const r = solveLine(inches(40), [{ kind: 'fixed', size: inches(12) + 100 }, { kind: 'fixed', size: inches(12) + 200 }], g);
    expect(r.sizes).toEqual([inches(12), inches(12 + 1 / 32)]);
  });

  it('gives equal flex items identical, grid-snapped sizes and a remainder', () => {
    const r = solveLine(inches(119), [flex(), flex(), flex()], g);
    expect(r.sizes[0]).toBe(inches(39 + 21 / 32));
    expect(new Set(r.sizes).size).toBe(1);
    expect(r.remainder).toBe(inches(1 / 32));
    expect(r.overflow).toBe(0);
  });

  it('divides by ratio after fixed items', () => {
    const r = solveLine(inches(48), [fixed(18), flex(2), flex(1)], g);
    expect(r.sizes).toEqual([inches(18), inches(20), inches(10)]);
    expect(r.remainder).toBe(0);
  });

  it('freezes min violators and redistributes', () => {
    const r = solveLine(inches(30), [flex(1, 20), flex(1), flex(1)], g);
    expect(r.sizes).toEqual([inches(20), inches(5), inches(5)]);
  });

  it('freezes max violators and redistributes', () => {
    const r = solveLine(inches(30), [flex(1, undefined, 6), flex(1), flex(1)], g);
    expect(r.sizes).toEqual([inches(6), inches(12), inches(12)]);
  });

  it('reports overflow when fixed sizes exceed the space', () => {
    const r = solveLine(inches(30), [fixed(20), fixed(15), flex()], g);
    expect(r.overflow).toBe(inches(5));
    expect(r.remainder).toBe(0);
    expect(r.sizes[2]).toBe(0);
  });

  it('reports overflow when flex minimums exceed the space', () => {
    const r = solveLine(inches(30), [flex(1, 20), flex(1, 20)], g);
    expect(r.sizes).toEqual([inches(20), inches(20)]);
    expect(r.overflow).toBe(inches(10));
  });
});
