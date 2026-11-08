import { describe, expect, it } from 'vitest';
import { mitredBoxGeometry, mitredCorners } from './mitre';

describe('mitredCorners', () => {
  it('cuts a front board end at 45°, long point on the front', () => {
    // 10 long (x), 3.5 tall (y), 0.75 thick (z), mitered at its right end.
    const c = mitredCorners([10, 3.5, 0.75], [{ face: 'right', outer: 'front' }]);
    const right = c.filter((p) => p[0] > 0);
    // Front corners reach the end; back corners stop one thickness short.
    expect(right.filter((p) => p[2] > 0).every((p) => p[0] === 5)).toBe(true);
    expect(right.filter((p) => p[2] < 0).every((p) => p[0] === 4.25)).toBe(true);
    // The left end is square.
    expect(c.filter((p) => p[0] < 0).every((p) => p[0] === -5)).toBe(true);
  });

  it('cuts the matching return so the two meet on the diagonal', () => {
    // A return running back (z), 0.75 thick (x), mitered at its front end with its right face outside.
    const c = mitredCorners([0.75, 3.5, 9], [{ face: 'front', outer: 'right' }]);
    const front = c.filter((p) => p[2] > 0);
    expect(front.filter((p) => p[0] > 0).every((p) => p[2] === 4.5)).toBe(true);
    expect(front.filter((p) => p[0] < 0).every((p) => p[2] === 3.75)).toBe(true);
  });

  it('builds a closed, flat-shaded block', () => {
    const g = mitredBoxGeometry([10, 3.5, 0.75], [{ face: 'right', outer: 'front' }]);
    expect(g.getAttribute('position').count).toBe(36);
    expect(g.getAttribute('normal').count).toBe(36);
  });
});
