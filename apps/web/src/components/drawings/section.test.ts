import { inches, type Part } from '@built-in-planner/engine';
import { describe, expect, it } from 'vitest';
import type { Chain } from './dimensions';
import { FRAME, T, derive, tierBoxes, withCounter, withDrawers } from './fixtures.test-util';
import { cutPosition, extractSection, sectionChains, sectionCuts, sectionLayout, sectionLetter } from './section';

const ats = (c: Chain | undefined) => [...new Set(c?.points.map((p) => p.at))].sort((a, b) => a - b);
const find = (chains: Chain[], side: Chain['side'], row: number) => chains.find((c) => c.side === side && c.row === row);
const ins = (...xs: number[]) => xs.map(inches);
const spans = (p: Part, x: number) => p.bounds.x < x && x < p.bounds.x + p.bounds.width;

describe('sectionLetter', () => {
  it('counts A…Z, then AA', () => {
    expect([0, 1, 25, 26, 27].map(sectionLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });
});

describe('sectionCuts', () => {
  it('cuts identical columns once, through base and upper, clear of uprights and the pair gap', () => {
    const { run, result } = derive();
    const cuts = sectionCuts(result);
    expect(cuts).toHaveLength(1);
    const [cut] = cuts;
    expect(cut!.label).toBe('A');
    expect(cut!.boxIds).toEqual([tierBoxes(run, 0)[0]!.id, tierBoxes(run, 1)[0]!.id]);
    const hit = result.parts.filter((p) => spans(p, cut!.x));
    expect(hit.some((p) => p.role === 'side' || p.role === 'stile')).toBe(false);
    expect(hit.filter((p) => p.role === 'door')).toHaveLength(1);
  });

  it('adds a cut where a column differs (a drawer bank)', () => {
    const { run, result } = derive(withDrawers);
    const cuts = sectionCuts(result);
    expect(cuts.map((c) => c.label)).toEqual(['A', 'B']);
    expect(cuts[1]!.boxIds[0]).toBe(tierBoxes(run, 0)[3]!.id);
    expect(result.parts.filter((p) => p.role === 'drawerFront' && spans(p, cuts[1]!.x))).toHaveLength(3);
  });

  it('avoids partitions and the gap between a door pair', () => {
    const { result } = derive();
    const b = result.boxes[0]!.carcass;
    const x = cutPosition(result, b.x, b.x + b.width);
    expect(x).toBeGreaterThan(b.x + T);
    expect(Math.abs(x - (b.x + b.width / 2))).toBeGreaterThan(inches(1));
  });
});

describe('extractSection', () => {
  const { result } = derive(withCounter);
  const [cut] = sectionCuts(result);
  const data = extractSection(result, cut!);

  it('collects what the plane cuts', () => {
    const roles = new Set(data.parts.map((p) => p.role));
    for (const r of ['back', 'top', 'bottom', 'rail', 'door', 'adjustableShelf', 'toeKick', 'countertop'] as const) expect(roles.has(r)).toBe(true);
    expect(roles.has('side')).toBe(false);
    expect(data.boxes).toHaveLength(2);
  });

  it('shows the uprights just beyond the plane in outline', () => {
    expect(data.beyond.length).toBeGreaterThan(0);
    expect(data.beyond.every((p) => p.bounds.x >= cut!.x)).toBe(true);
    expect(data.beyond.some((p) => p.role === 'side')).toBe(true);
  });

  it('spans wall to the counter edge and floor to ceiling', () => {
    expect([data.u0, data.u1]).toEqual([0, inches(16) + FRAME + inches(1)]);
    expect([data.v0, data.v1]).toEqual(ins(0, 96));
  });

  it('can be limited to some parts', () => {
    const d = extractSection(result, cut!, (p) => p.role === 'door');
    expect(d.parts.map((p) => p.role)).toEqual(['door']);
  });
});

describe('sectionChains', () => {
  const { result } = derive(withCounter);
  const data = extractSection(result, sectionCuts(result)[0]!);
  const chains = sectionChains(result, data);

  it('stacks heights on the front side: kick, carcass, counter, space, upper, ceiling gap', () => {
    expect(ats(find(chains, 'right', 0))).toEqual(ins(0, 3.5, 28.5, 30, 95.5, 96));
    expect(ats(find(chains, 'right', 1))).toEqual(ins(0, 95.5));
    expect(ats(find(chains, 'right', 2))).toEqual(ins(0, 96));
  });

  it('gives base depths below and upper depths above', () => {
    expect(ats(find(chains, 'bottom', 0))).toEqual([0, inches(16), inches(16) + FRAME, inches(16) + FRAME + T]);
    expect(ats(find(chains, 'top', 0))).toEqual([0, inches(12), inches(12) + FRAME]);
  });

  it('dimensions the counter overhang and the toe kick setback', () => {
    expect(ats(find(chains, 'top', 1))).toEqual([0, inches(16) + FRAME, inches(17.75)]);
    expect(ats(find(chains, 'bottom', 1))).toEqual([inches(13.75), inches(16) + FRAME]);
  });

  it('reserves paper for its chains, poché and caption', () => {
    const { need } = sectionLayout(result, data);
    expect(need.w).toBe(data.u1);
    expect(need.pad.right).toBeGreaterThan(need.pad.left);
    expect(need.pad.top).toBeGreaterThan(0);
    expect(need.pad.bottom).toBeGreaterThan(need.pad.top);
  });
});
