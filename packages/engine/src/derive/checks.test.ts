import { describe, expect, it } from 'vitest';
import { createDefaultProject, flexBox, opening } from '../defaults';
import { inches } from '../units';
import { shelfSag } from './checks';
import { deriveRun } from './index';

describe('shelf sag', () => {
  it('follows the uniform-load beam formula', () => {
    // 36" span, 11 1/2" deep, 23/32" plywood (E = 1,000,000 psi), 20 lb/ft².
    const sag = shelfSag(inches(36), inches(11.5), inches(23 / 32), 20, 1_000_000);
    const w = (20 * 11.5) / 144;
    const I = (11.5 * (23 / 32) ** 3) / 12;
    expect(sag).toBeCloseTo((5 * w * 36 ** 4) / (384 * 1_000_000 * I), 6);
    expect(sag).toBeCloseTo(0.0982, 3);
    // Doubling the span multiplies sag by 16.
    expect(shelfSag(inches(72), inches(11.5), inches(23 / 32), 20, 1_000_000) / sag).toBeCloseTo(16, 6);
  });

  it('flags long adjustable shelves and respects material stiffness', () => {
    const project = createDefaultProject();
    const run = project.runs[0]!;
    const upper = run.tiers[1]!;
    // One 42" box (shelves span about 40 1/2") beside three ~25 1/2" flex boxes.
    const wide = { ...flexBox(opening({ type: 'none' }, 3)), width: { kind: 'fixed' as const, size: inches(42) } };
    upper.items = [flexBox(opening({ type: 'none' }, 3)), flexBox(opening({ type: 'none' }, 3)), flexBox(opening({ type: 'none' }, 3)), wide];
    const codes = deriveRun(project, run.id).issues.filter((i) => i.code === 'shelf-sag');
    expect(codes.map((c) => c.sourceId)).toEqual([wide.content.id]);
    expect(codes[0]!.message).toContain('lb/ft²');
    // A much stiffer shelf material passes.
    project.materials = project.materials.map((m) => (m.id === 'ply-23-32' ? { ...m, modulus: 4_000_000 } : m));
    expect(deriveRun(project, run.id).issues.some((i) => i.code === 'shelf-sag')).toBe(false);
  });

  it('passes the default project', () => {
    const project = createDefaultProject();
    expect(deriveRun(project, project.runs[0]!.id).issues.some((i) => i.code === 'shelf-sag')).toBe(false);
  });
});
