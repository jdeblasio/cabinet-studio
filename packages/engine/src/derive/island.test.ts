import { describe, expect, it } from 'vitest';
import { collectParts } from '../cutlist/parts';
import { createDefaultProject } from '../defaults';
import type { Project } from '../model';
import { addIsland, islandBack, removeRun, setIslandBack } from '../ops';
import { inches } from '../units';
import { deriveProject, deriveRun } from './index';

const T = inches(23 / 32);
const withIsland = (mutate?: (p: Project, islandId: string) => void) => {
  const project = createDefaultProject();
  const id = addIsland(project);
  mutate?.(project, id);
  return { project, id, front: deriveRun(project, id), back: islandBack(project, id) ? deriveRun(project, islandBack(project, id)!.id) : undefined };
};

describe('islands', () => {
  it('are a front face and a linked back face, added and removed together', () => {
    const project = createDefaultProject();
    const id = addIsland(project);
    const back = islandBack(project, id)!;
    expect(project.runs.map((r) => r.kind ?? 'wall')).toEqual(['wall', 'island', 'island']);
    expect(back.islandOf).toBe(id);
    expect(removeRun(project, back.id)).toBe(false);
    expect(removeRun(project, id)).toBe(true);
    expect(project.runs).toHaveLength(1);
  });

  it('derive with finished ends, no walls, and a countertop over both faces with a seating overhang', () => {
    const { front, back } = withIsland();
    expect(front.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(back!.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(front.issues.map((i) => i.code)).toEqual(['countertop-seating-overhang']);
    // 36" tall to the top of the countertop: no ceiling scribe.
    expect(front.tiers[0]).toMatchObject({ y: 0, height: inches(36), toeKick: inches(3.5), countertop: inches(1.5) });
    const top = front.parts.find((p) => p.role === 'countertop')!;
    // Back face: 12" boxes + 3/4" frame, then the 12" seating overhang; front: 12" + 3/4" + 1".
    expect(top.bounds.z).toBe(-inches(12.75 + 12));
    expect(top.bounds.z + top.bounds.depth).toBe(inches(12.75 + 1));
    expect([top.bounds.x, top.bounds.width]).toEqual([-inches(1), inches(74)]);
    // The back face has no countertop of its own, but its boxes stop under the island's.
    expect(back!.parts.some((p) => p.role === 'countertop')).toBe(false);
    expect(Math.max(...back!.boxes.map((b) => b.carcass.y + b.carcass.height))).toBe(inches(34.5));
  });

  it('take the front face tier heights on the back face', () => {
    const { back } = withIsland((p, id) => {
      const b = islandBack(p, id)!;
      b.tiers[0]!.height = { kind: 'fixed', size: inches(20) };
      delete b.tiers[0]!.toeKick;
    });
    expect(back!.tiers[0]).toMatchObject({ height: inches(36), toeKick: inches(3.5), countertop: inches(1.5) });
  });

  it('carry the back face, mirrored behind the spine, on the main run (but count it once)', () => {
    const { project, id, front, back } = withIsland();
    const mirrored = front.island!;
    expect(mirrored.backRunId).toBe(islandBack(project, id)!.id);
    expect(mirrored.parts).toHaveLength(back!.parts.length);
    const side = back!.parts.find((p) => p.role === 'side')!;
    const m = mirrored.parts.find((p) => p.id === side.id)!;
    expect(m.bounds.x).toBe(front.width - (side.bounds.x + side.bounds.width));
    expect(m.bounds.z).toBe(-(side.bounds.z + side.bounds.depth));
    // The cut list counts each face's own parts, not the mirrored copy.
    const counted = collectParts(deriveProject(project)).filter((p) => p.runId !== project.runs[0]!.id);
    expect(counted).toHaveLength(front.parts.length + back!.parts.length);
  });

  it('leave no raw edges showing', () => {
    const { front, back } = withIsland();
    expect([...front.parts, ...back!.parts].filter((p) => p.rawEdges)).toEqual([]);
  });

  it('can be single-sided, with a finished back panel instead of back boxes', () => {
    const { project, id, front, back } = withIsland((p, islandId) => void setIslandBack(p, islandId, 'panel'));
    expect(back).toBeUndefined();
    expect(project.runs).toHaveLength(2);
    const panel = front.parts.find((p) => p.name === 'Finished back')!;
    // Between the end panels, which run back over its ends.
    expect(panel.bounds).toMatchObject({ x: T, y: 0, z: -T, width: inches(72) - 2 * T, height: inches(34.5), depth: T });
    const ends = front.parts.filter((p) => p.name === 'End panel');
    expect(ends.every((p) => p.bounds.z === -T)).toBe(true);
    expect(front.parts.filter((p) => p.rawEdges)).toEqual([]);
    expect(front.parts.find((p) => p.role === 'countertop')!.bounds.z).toBe(-T - inches(12));
    expect(front.island).toBeUndefined();
    // Switching back to boxes adds a fresh back face.
    setIslandBack(project, id, 'boxes');
    expect(islandBack(project, id)).toBeDefined();
    expect(deriveRun(project, id).island).toBeDefined();
  });
});
