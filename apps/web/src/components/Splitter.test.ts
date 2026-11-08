import { describe, expect, it } from 'vitest';
import { clampSplit, DEFAULT_SPLIT, dragSplit } from './Splitter';

describe('dragSplit', () => {
  it('moves the divider by the drag distance', () => {
    expect(dragSplit(300, 500, 50)).toBeCloseTo(350 / 500);
    expect(dragSplit(300, 500, -100)).toBeCloseTo(200 / 500);
  });

  it('keeps each pane at least the minimum height', () => {
    expect(dragSplit(300, 500, -1000)).toBeCloseTo(80 / 500);
    expect(dragSplit(300, 500, 1000)).toBeCloseTo(420 / 500);
  });

  it('splits evenly when there is no room for two minimum panes', () => {
    expect(dragSplit(50, 100, 30)).toBeCloseTo(0.5);
  });

  it('falls back to the default with no height to split', () => {
    expect(dragSplit(0, 0, 10)).toBe(DEFAULT_SPLIT);
  });
});

describe('clampSplit', () => {
  it('keeps the split between 5% and 95%', () => {
    expect(clampSplit(-1)).toBe(0.05);
    expect(clampSplit(2)).toBe(0.95);
    expect(clampSplit(0.4)).toBe(0.4);
  });
});
