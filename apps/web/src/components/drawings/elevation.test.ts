import { inches } from '@cabinet-studio/engine';
import { describe, expect, it } from 'vitest';
import type { Chain as DimChain } from './dimensions';
import { boxChains, boxView, elevationChains, frontLeaves } from './elevation';
import { T, derive, tierBoxes, withCounter, withDoorway } from './fixtures.test-util';

const ats = (c: DimChain | undefined) => [...new Set(c?.points.map((p) => p.at))].sort((a, b) => a - b);
const find = (chains: DimChain[], side: DimChain['side'], row: number) => chains.find((c) => c.side === side && c.row === row);
const ins = (...xs: number[]) => xs.map(inches);

describe('elevationChains', () => {
  const { result } = derive();
  const chains = elevationChains(result);

  it('dimensions upper box widths above, then the overall width', () => {
    expect(ats(find(chains, 'top', 0))).toEqual(ins(0, 0.5, 30.25, 60, 89.75, 119.5, 120));
    expect(find(chains, 'top', 0)!.points.every((p) => p.from === inches(95.5))).toBe(true);
    expect(ats(find(chains, 'top', 1))).toEqual(ins(0, 120));
  });

  it('dimensions base box widths below, from the floor', () => {
    const c = find(chains, 'bottom', 0)!;
    expect(ats(c)).toEqual(ins(0, 0.5, 30.25, 60, 89.75, 119.5, 120));
    expect(c.points.every((p) => p.from === 0)).toBe(true);
  });

  it('dimensions tier heights and the overall height on the left', () => {
    expect(ats(find(chains, 'left', 0))).toEqual(ins(0, 30, 95.5, 96));
    expect(ats(find(chains, 'left', 1))).toEqual(ins(0, 95.5));
  });

  it('dimensions toe kick and countertop on the right, then the ceiling', () => {
    const { result: r } = derive(withCounter);
    const c = elevationChains(r);
    expect(ats(find(c, 'right', 0))).toEqual(ins(0, 3.5, 28.5, 30, 95.5, 96));
    expect(ats(find(c, 'right', 1))).toEqual(ins(0, 96));
  });

  it('includes gaps in the tier chain', () => {
    const { result: r } = derive(withDoorway);
    expect(ats(find(elevationChains(r), 'bottom', 0))).toContain(inches(83.5));
  });
});

describe('frontLeaves', () => {
  it('splits each door pair into a left- and a right-hinged leaf', () => {
    const { result } = derive();
    const leaves = frontLeaves(result);
    expect(leaves).toHaveLength(8);
    expect(leaves.filter((l) => l.hinge === 'left')).toHaveLength(4);
    const [l, r] = leaves;
    expect(l!.rect.x + l!.rect.width).toBeLessThan(r!.rect.x);
    expect(l!.rect.height).toBe(inches(24.5));
  });

  it('can be limited to one box', () => {
    const { run, result } = derive();
    expect(frontLeaves(result, tierBoxes(run, 0)[0]!.id)).toHaveLength(2);
    expect(frontLeaves(result, tierBoxes(run, 1)[0]!.id)).toHaveLength(0);
  });
});

describe('box view', () => {
  const { run, result } = derive();
  const box = (i: number) => result.boxes.find((b) => b.id === tierBoxes(run, 0)[i]!.id)!;

  it('chains frame members and openings, then overall sizes', () => {
    const c = boxChains(box(0));
    expect(ats(find(c, 'top', 0))).toEqual([inches(0.5), inches(0.5) + T, inches(30.25) - T, inches(30.25)]);
    expect(ats(find(c, 'top', 1))).toEqual(ins(0.5, 30.25));
    expect(ats(find(c, 'left', 0))).toEqual(ins(3.5, 5, 28.5, 30));
    expect(ats(find(c, 'left', 1))).toEqual(ins(3.5, 30));
  });

  it('shows the box with both shared stiles, whoever owns them, and no toe kick', () => {
    const v = boxView(result, box(1));
    const stiles = v.parts.filter((p) => p.role === 'stile');
    expect(stiles).toHaveLength(2);
    expect(stiles.some((s) => s.ownerId !== box(1).id)).toBe(true);
    expect(v.parts.some((p) => p.role === 'toeKick')).toBe(false);
    expect([v.u0, v.u1]).toEqual([inches(30.25) - T, inches(60) + T]);
    expect([v.v0, v.v1]).toEqual(ins(3.5, 30));
  });
});
