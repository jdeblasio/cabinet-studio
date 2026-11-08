import { inches, mm, type Part, type PartFeature } from '@built-in-planner/engine';
import { describe, expect, it } from 'vitest';
import { cupChain, edgeDistance, holeSummary, pinRowChains } from './features';

const hole = (over: Partial<PartFeature>): PartFeature => ({ kind: 'hole', label: 'Shelf pin', x: 0, y: 0, z: 0, axis: 'x', diameter: mm(5), depth: inches(3 / 8), ...over });

const side: Part = {
  id: 'box/side-right',
  name: 'Right side',
  role: 'side',
  materialId: 'm',
  length: inches(30),
  width: inches(12),
  thickness: inches(0.75),
  bounds: { x: inches(29), y: inches(30), z: inches(0.25), width: inches(0.75), height: inches(30), depth: inches(12) },
  ownerId: 'box',
  features: [inches(36), inches(36) + mm(32), inches(36) + mm(64)].flatMap((y) =>
    [inches(1.75), inches(10.75)].map((z) => hole({ x: inches(29), y, z })),
  ),
};

const door: Part = {
  id: 'op/door',
  name: 'Door',
  role: 'door',
  materialId: 'm',
  length: inches(24),
  width: inches(15),
  thickness: inches(0.75),
  bounds: { x: inches(1), y: inches(4), z: inches(16.75), width: inches(15), height: inches(24), depth: inches(0.75) },
  ownerId: 'box',
  features: [inches(7), inches(25)].map((y) => hole({ label: 'Hinge cup', axis: 'z', x: inches(1) + mm(22.5), y, z: inches(16.75), diameter: mm(35), depth: mm(13) })),
};

describe('holeSummary', () => {
  it('counts holes by label, with the row pitch of evenly spaced rows', () => {
    const s = holeSummary([side, door, { ...side, id: 'box/side-left' }]);
    expect(s).toEqual([
      { label: 'Shelf pin', count: 12, parts: 2, diameter: mm(5), depth: inches(3 / 8), pitch: mm(32) },
      { label: 'Hinge cup', count: 2, parts: 1, diameter: mm(35), depth: mm(13) },
    ]);
  });

  it('is empty for parts without features', () => {
    expect(holeSummary([{ ...side, features: undefined }])).toEqual([]);
  });
});

describe('pinRowChains', () => {
  it('dimensions the first and last hole from the panel ends, and the rows across its depth', () => {
    const [up, across] = pinRowChains(side);
    expect(up!.side).toBe('left');
    expect(up!.points.map((p) => p.at)).toEqual([inches(30), inches(36), inches(36) + mm(64), inches(60)]);
    expect(across!.side).toBe('top');
    expect(across!.points.map((p) => p.at)).toEqual([inches(0.25), inches(1.75), inches(10.75), inches(12.25)]);
  });
});

describe('hinge cups', () => {
  it('chains the cups up the door', () => {
    expect(cupChain(door)!.points.map((p) => p.at)).toEqual([inches(4), inches(7), inches(25), inches(28)]);
    expect(cupChain(side)).toBeNull();
  });

  it('measures the boring distance from the nearer edge', () => {
    expect(edgeDistance(door, door.features![0]!)).toBe(mm(22.5));
  });
});
