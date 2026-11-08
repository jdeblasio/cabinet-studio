import { inches } from '@built-in-planner/engine';
import { describe, expect, it } from 'vitest';
import type { Chain } from './dimensions';
import { FRAME, T, derive, withCounter, withDoorway } from './fixtures.test-util';
import { depthProfile, mergeRuns, planChains, planTiers } from './plan';

const ats = (c: Chain | undefined) => [...new Set(c?.points.map((p) => p.at))].sort((a, b) => a - b);
const find = (chains: Chain[], side: Chain['side'], row: number) => chains.find((c) => c.side === side && c.row === row);

describe('planTiers', () => {
  const { result } = derive();
  const [base, upper] = planTiers(result);

  it('has one footprint per box tier', () => {
    expect(planTiers(result)).toHaveLength(2);
    expect(base!.boxes).toHaveLength(4);
    expect(upper!.boxes).toHaveLength(4);
    expect(base!.boxes[0]!.rect).toEqual({ x: inches(0.5), z: 0, width: inches(29.75), depth: inches(16) });
  });

  it('projects the face frame and fronts once each', () => {
    // Five stiles, plus each box's top and bottom rails, which coincide in plan.
    expect(base!.frame).toHaveLength(9);
    expect(base!.fronts).toHaveLength(8);
    expect(upper!.fronts).toHaveLength(0);
  });

  it('outlines the toe kick platform to the kick face', () => {
    expect(base!.kicks).toEqual([{ x: 0, z: 0, width: inches(120), depth: inches(13.75) }]);
    expect(upper!.kicks).toEqual([]);
  });

  it('reaches as deep as the fronts', () => {
    expect(base!.depth).toBe(inches(16) + FRAME + T);
  });
});

describe('mergeRuns', () => {
  it('joins pieces end to end and keeps separate runs apart', () => {
    const r = (x: number, width: number, depth = 10) => ({ x, z: 0, width, depth });
    expect(mergeRuns([r(50, 30), r(0, 50), r(100, 20), r(0, 20, 5)])).toEqual([r(0, 20, 5), r(0, 80), r(100, 20)]);
  });
});

describe('planChains', () => {
  it('dimensions depths, frame, fronts and the toe kick setback at the right end', () => {
    const { result } = derive();
    const chains = planChains(result, planTiers(result)[0]!);
    expect(ats(find(chains, 'right', 0))).toEqual([0, inches(16), inches(16) + FRAME, inches(16) + FRAME + T]);
    expect(ats(find(chains, 'right', 1))).toEqual([inches(13.75), inches(16) + FRAME]);
    // Identical boxes at both ends: no repeat on the left.
    expect(chains.some((c) => c.side === 'left')).toBe(false);
    expect(ats(find(chains, 'bottom', 0))).toEqual([0, inches(120)]);
  });

  it('dimensions the countertop: overhang past the frame, and its end overhang at a gap', () => {
    const { result } = derive((p, r) => {
      withCounter(p, r);
      withDoorway(p, r);
    });
    const plan = planTiers(result)[0]!;
    expect(plan.countertops).toHaveLength(1);
    expect(plan.gaps).toHaveLength(1);
    const chains = planChains(result, plan);
    expect(ats(find(chains, 'right', 1))).toEqual([0, inches(16) + FRAME, inches(17.75)]);
    expect(ats(find(chains, 'bottom', 0))).toEqual([0, inches(83.5), inches(84.5)]);
    // Boxes, then the doorway and scribe to the right wall.
    expect(ats(find(chains, 'bottom', 1))).toEqual([0, inches(83.5), inches(120)]);
  });

  it('reads a box depth profile from what overlaps it', () => {
    const { result } = derive(withCounter);
    const plan = planTiers(result)[0]!;
    const p = depthProfile(plan, plan.boxes[1]!.rect);
    expect(p).toMatchObject({ carcass: inches(16), frame: inches(16) + FRAME, counter: inches(17.75), kick: inches(13.75) });
  });
});
