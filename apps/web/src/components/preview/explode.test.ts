import { createDefaultProject, deriveRun, TICKS_PER_INCH } from '@cabinet-studio/engine';
import { describe, expect, it } from 'vitest';
import { explodeOffsets } from './explode';

const I = (t: number) => t / TICKS_PER_INCH;

describe('explodeOffsets', () => {
  const project = createDefaultProject();
  const result = deriveRun(project, project.runs[0]!.id);
  const offsets = explodeOffsets(result);

  it('moves every part', () => {
    expect(offsets.size).toBe(result.parts.length);
  });

  it('keeps every part above the floor and in front of the wall', () => {
    const lowest = Math.min(...result.parts.map((p) => I(p.bounds.y) + offsets.get(p.id)![1]));
    const rearmost = Math.min(...result.parts.map((p) => I(p.bounds.z) + offsets.get(p.id)![2]));
    // The toe kick sits on the floor and the backs on the wall, so both touch after lifting.
    expect(lowest).toBeCloseTo(0, 6);
    expect(rearmost).toBeCloseTo(0, 6);
  });

  it('still pulls a box top above its bottom', () => {
    const box = result.boxes[0]!;
    const top = result.parts.find((p) => p.ownerId === box.id && p.role === 'top')!;
    const bottom = result.parts.find((p) => p.ownerId === box.id && p.role === 'bottom')!;
    const gap = I(top.bounds.y) + offsets.get(top.id)![1] - (I(bottom.bounds.y + bottom.bounds.height) + offsets.get(bottom.id)![1]);
    expect(gap).toBeGreaterThan(I(top.bounds.y) - I(bottom.bounds.y + bottom.bounds.height));
  });
});
