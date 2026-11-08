import { describe, expect, it } from 'vitest';
import { inches } from '../units';
import { planPieces } from './split';

const G = inches(1 / 32);
const at = (x: number, why = 'on the partition') => ({ from: inches(x), to: inches(x), why });

describe('planPieces', () => {
  it('fits without joints when short enough', () => {
    expect(planPieces(0, inches(90), inches(95.5), [], G)).toEqual([{ from: 0, to: inches(90) }]);
  });

  it('uses hidden seams when that avoids visible joints, even if it means more pieces', () => {
    const pieces = planPieces(0, inches(146), inches(95.5), [at(49), at(97.5)], G);
    expect(pieces.map((p) => p.to)).toEqual([inches(49), inches(97.5), inches(146)]);
    expect(pieces.slice(0, -1).every((p) => p.joint?.why === 'on the partition')).toBe(true);
  });

  it('prefers fewer pieces when visible joints are needed anyway', () => {
    // 47.5" pieces: the partitions don't save a visible joint, so split evenly in four.
    const pieces = planPieces(0, inches(146), inches(47.5), [at(49), at(97.5)], G);
    expect(pieces).toHaveLength(4);
    expect(pieces.every((p) => p.to - p.from <= inches(47.5))).toBe(true);
    expect(pieces.every((p) => p.to - p.from > inches(36))).toBe(true);
  });

  it('skips over a seam a stile wide', () => {
    const stile = { from: inches(72), to: inches(73.5), why: 'at the mid stile' };
    const pieces = planPieces(0, inches(146), inches(100), [stile], G);
    expect(pieces.map((p) => [p.from, p.to])).toEqual([
      [0, inches(72)],
      [inches(73.5), inches(146)],
    ]);
  });
});

describe('planPieces balance', () => {
  it('picks the most even of equally good hidden seams', () => {
    const pieces = planPieces(0, inches(146), inches(120), [at(29), at(58.5), at(88), at(117)], G);
    expect(pieces.map((p) => p.to)).toEqual([inches(58.5), inches(146)]);
  });
});
