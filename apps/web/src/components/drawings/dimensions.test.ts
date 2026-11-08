import { describe, expect, it } from 'vitest';
import { DIM, END_ROOM, chainPads, compactChains, layoutChain, placeLabels, rowOffset, stackSize, textWidth, type Chain } from './dimensions';

const seg = (a: number, b: number, width = 10) => ({ a, b, width });
const overlap = (p: { pos: number; w: number }, q: { pos: number; w: number }) => Math.abs(p.pos - q.pos) < (p.w + q.w) / 2;

describe('placeLabels', () => {
  it('centers labels that fit on their segment', () => {
    expect(placeLabels([seg(0, 40), seg(40, 100)])).toEqual([
      { pos: 20, lane: 0, moved: false },
      { pos: 70, lane: 0, moved: false },
    ]);
  });

  it('moves a tight first or last label past the end of the chain', () => {
    const [first, , last] = placeLabels([seg(0, 4), seg(4, 60), seg(60, 63)]);
    expect(first!.lane).toBe(0);
    expect(first!.pos + 5).toBeLessThan(0);
    expect(last!.lane).toBe(0);
    expect(last!.pos - 5).toBeGreaterThan(63);
  });

  it('keeps tight end labels within the chain when ends are off (vertical chains)', () => {
    const out = placeLabels([seg(0, 4), seg(4, 60), seg(60, 63)], false);
    expect(out[0]).toEqual({ pos: 2, lane: 1, moved: false });
    expect(out[2]).toEqual({ pos: 61.5, lane: 1, moved: false });
  });

  it('puts tight middle labels on the other side of the line without overlapping', () => {
    const segs = [seg(0, 40), seg(40, 43), seg(43, 46), seg(46, 49), seg(49, 100)];
    const out = placeLabels(segs);
    const mids = out.slice(1, 4);
    expect(mids.every((m) => m.lane === 1)).toBe(true);
    for (let i = 1; i < mids.length; i++) {
      expect(overlap({ pos: mids[i - 1]!.pos, w: 10 }, { pos: mids[i]!.pos, w: 10 })).toBe(false);
    }
    // The first stays on its segment; the pushed ones get leaders.
    expect(mids[0]!.moved).toBe(false);
    expect(mids[2]!.moved).toBe(true);
    // Labels that fit are unaffected.
    expect(out[0]).toEqual({ pos: 20, lane: 0, moved: false });
  });
});

describe('layoutChain', () => {
  const fmt = (t: number) => `${t}`;

  it('merges points at the same position, keeping the extension line nearest the dimension line', () => {
    // A top chain: the dimension line is above (smaller y) the features.
    const l = layoutChain(
      [
        { pos: 0, from: 100, value: 0 },
        { pos: 50, from: 100, value: 500 },
        { pos: 50, from: 60, value: 500 },
        { pos: 120, from: 100, value: 1200 },
      ],
      'top',
      30,
      fmt,
    )!;
    expect(l.ticks).toEqual([0, 50, 120]);
    expect(l.labels.map((x) => x.text)).toEqual(['500', '700']);
    const mid = l.ext.find((e) => e.pos === 50)!;
    expect(mid.from).toBe(60 - DIM.extGap);
    expect(mid.to).toBe(30 - DIM.extOver);
  });

  it('runs extension lines toward the line from either side', () => {
    const l = layoutChain(
      [
        { pos: 0, from: 10, value: 0 },
        { pos: 80, from: 10, value: 80 },
      ],
      'bottom',
      40,
      fmt,
    )!;
    expect(l.ext.every((e) => e.from === 10 + DIM.extGap && e.to === 40 + DIM.extOver)).toBe(true);
  });

  it('needs two distinct points', () => {
    expect(layoutChain([{ pos: 3, from: 0, value: 3 }], 'left', 0, fmt)).toBeNull();
  });
});

describe('chain bookkeeping', () => {
  const c = (side: Chain['side'], row: number, ats: number[]): Chain => ({ side, row, points: ats.map((at) => ({ at, from: 0 })) });

  it('drops empty and repeated chains and closes up the rows', () => {
    const out = compactChains([c('top', 0, [0, 10]), c('top', 1, [5]), c('top', 2, [10, 0]), c('top', 3, [0, 20]), c('left', 0, [0, 10])]);
    expect(out.map((x) => [x.side, x.row, x.points.map((p) => p.at)])).toEqual([
      ['top', 0, [0, 10]],
      ['left', 0, [0, 10]],
      ['top', 1, [0, 20]],
    ]);
  });

  it('sizes stacks from the rows used', () => {
    expect(stackSize(0)).toBe(0);
    expect(stackSize(0, 6)).toBe(6);
    expect(stackSize(2)).toBeGreaterThan(rowOffset(1));
    const pads = chainPads([c('top', 0, [0, 1]), c('top', 1, [0, 2]), c('right', 0, [0, 1])], { left: 6 });
    // Left and bottom have no chains of their own but keep room for end labels.
    expect(pads).toEqual({ top: stackSize(2), right: Math.max(stackSize(1), END_ROOM.horizontal), bottom: END_ROOM.vertical, left: END_ROOM.horizontal });
    expect(chainPads([], { left: 6 })).toEqual({ top: 0, right: 0, bottom: 0, left: 6 });
  });

  it('estimates text width from its characters', () => {
    expect(textWidth('29 3/4"', 10)).toBeGreaterThan(textWidth('3/4"', 10));
    expect(textWidth('', 10)).toBe(0);
  });
});
