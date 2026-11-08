import { inches, type Part } from '@built-in-planner/engine';
import { describe, expect, it } from 'vitest';
import { derive, tierBoxes } from './fixtures.test-util';
import { boxLabels, boxParts, commonName, frontToBack, groupParts, roleClass } from './parts';

const part = (over: Partial<Part>): Part => ({
  id: over.id ?? Math.random().toString(36),
  name: 'Part',
  role: 'side',
  materialId: 'm',
  length: inches(30),
  width: inches(16),
  thickness: inches(0.75),
  bounds: { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1 },
  ownerId: 'b',
  ...over,
});

describe('commonName', () => {
  it('keeps a shared name', () => expect(commonName(['Back', 'Back'])).toBe('Back'));
  it('drops left/right/top/bottom qualifiers', () => {
    expect(commonName(['Left side', 'Right side'])).toBe('Side');
    expect(commonName(['Top rail', 'Bottom rail', 'Mid rail'])).toBe('Rail');
  });
  it('keeps shared leading words with the differing qualifiers', () => {
    expect(commonName(['Drawer box front', 'Drawer box back'])).toBe('Drawer box front/back');
  });
  it('joins names that differ otherwise', () => {
    expect(commonName(['Top', 'Bottom'])).toBe('Top / Bottom');
    expect(commonName(['Shared stile', 'Scribe stile'])).toBe('Shared stile / Scribe stile');
  });
});

describe('groupParts', () => {
  it('counts identical parts together and orders by role, then size', () => {
    const groups = groupParts([
      part({ name: 'Door', role: 'door', width: inches(14) }),
      part({ name: 'Left side' }),
      part({ name: 'Right side' }),
      part({ name: 'Door', role: 'door', width: inches(14) }),
      part({ name: 'Wide door', role: 'door', width: inches(20) }),
      part({ name: 'Side', materialId: 'other' }),
    ]);
    expect(groups.map((g) => [g.name, g.qty])).toEqual([
      ['Side', 2],
      ['Side', 1],
      ['Wide door', 1],
      ['Door', 2],
    ]);
  });

  it('groups a real box: sides, rails and the door pair in pairs', () => {
    const { run, result } = derive();
    const id = tierBoxes(run, 0)[0]!.id;
    const owned = boxParts(result, id);
    const groups = groupParts(owned);
    expect(groups.reduce((s, g) => s + g.qty, 0)).toBe(owned.length);
    expect(groups.find((g) => g.role === 'side')).toMatchObject({ name: 'Side', qty: 2 });
    expect(groups.find((g) => g.role === 'rail')).toMatchObject({ name: 'Rail', qty: 2 });
    expect(groups[0]!.role).toBe('side');
  });
});

describe('boxLabels', () => {
  it('numbers boxes bottom tier first, left to right, and names them by tier', () => {
    const { run, result } = derive((_, r) => {
      tierBoxes(r, 1)[2]!.name = 'Bookcase';
    });
    const labels = boxLabels(run, result);
    const base = tierBoxes(run, 0).map((b) => labels.get(b.id)!);
    const upper = tierBoxes(run, 1).map((b) => labels.get(b.id)!);
    expect(base.map((l) => l.num)).toEqual([1, 2, 3, 4]);
    expect(upper.map((l) => l.num)).toEqual([5, 6, 7, 8]);
    expect(base[0]).toMatchObject({ name: 'Base 1', tierName: 'Base' });
    expect(upper[2]!.name).toBe('Bookcase');
  });
});

describe('roles', () => {
  it('classifies roles, falling back for unknown ones', () => {
    expect(roleClass('door')).toBe('front');
    expect(roleClass('frontPanel')).toBe('panel');
    expect(roleClass('drawerBox')).toBe('interior');
    expect(roleClass('molding')).toBe('trim');
    expect(roleClass('somethingNew')).toBe('carcass');
  });

  it('paints back to front, fronts last on ties', () => {
    const back = part({ id: 'back', bounds: { x: 0, y: 0, z: 0, width: 1, height: 1, depth: 2 } });
    const door = part({ id: 'door', role: 'door', bounds: { x: 0, y: 0, z: 2, width: 1, height: 1, depth: 1 } });
    const rail = part({ id: 'rail', role: 'rail', bounds: { x: 0, y: 0, z: 2, width: 1, height: 1, depth: 1 } });
    expect(frontToBack([door, rail, back]).map((p) => p.id)).toEqual(['back', 'rail', 'door']);
  });
});

describe('groupParts edge banding', () => {
  it('says which edges are banded, keeping banded and plain parts apart', () => {
    const { result } = derive();
    const groups = groupParts(result.parts);
    expect(groups.find((g) => g.role === 'adjustableShelf')!.banding).toBe('Front edge');
    expect(groups.find((g) => g.role === 'door')!.banding).toBe('All 4 edges');
    expect(groups.find((g) => g.role === 'side')!.banding).toBe('');
  });
});
