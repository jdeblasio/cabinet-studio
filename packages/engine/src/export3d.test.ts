import { describe, expect, it } from 'vitest';
import { createDefaultProject } from './defaults';
import { deriveRun } from './derive/index';
import { toGLTF, toOBJ, toSTL } from './export3d';
import { inches } from './units';

const project = createDefaultProject();
const { parts } = deriveRun(project, project.runs[0]!.id);

describe('3D exports', () => {
  it('writes a binary STL with 12 triangles per part, in millimeters', () => {
    const buf = toSTL(parts);
    const view = new DataView(buf);
    expect(buf.byteLength).toBe(84 + 50 * 12 * parts.length);
    expect(view.getUint32(80, true)).toBe(12 * parts.length);
    // First triangle of the first part: its normal is a unit vector and a vertex lies at the part's min corner.
    const n = [0, 1, 2].map((i) => view.getFloat32(84 + i * 4, true));
    expect(Math.hypot(...n)).toBeCloseTo(1);
    const v0 = [0, 1, 2].map((i) => view.getFloat32(84 + 12 + i * 4, true));
    const b = parts[0]!.bounds;
    expect(v0[0]).toBeCloseTo((b.x / inches(1)) * 25.4, 3);
  });

  it('writes an OBJ with one object, 8 vertices and 6 faces per part', () => {
    const obj = toOBJ(parts, 'imperial');
    const lines = obj.trim().split('\n');
    expect(lines.filter((l) => l.startsWith('o ')).length).toBe(parts.length);
    expect(lines.filter((l) => l.startsWith('v ')).length).toBe(8 * parts.length);
    expect(lines.filter((l) => l.startsWith('f ')).length).toBe(6 * parts.length);
    expect(obj).toContain('Units: inches');
    // Face indices stay within the vertex list.
    const maxIndex = Math.max(...lines.filter((l) => l.startsWith('f ')).flatMap((l) => l.slice(2).split(' ').map(Number)));
    expect(maxIndex).toBe(8 * parts.length);
  });

  it('writes a glTF with a shared cube mesh per material and a node per part, in meters', () => {
    const gltf = JSON.parse(toGLTF(parts, project.materials));
    expect(gltf.asset.version).toBe('2.0');
    expect(gltf.nodes).toHaveLength(parts.length);
    const used = new Set(parts.map((p) => p.materialId));
    expect(gltf.meshes).toHaveLength(used.size);
    expect(gltf.materials).toHaveLength(used.size);
    expect(gltf.accessors.map((a: { count: number }) => a.count)).toEqual([24, 24, 36]);
    const uri: string = gltf.buffers[0].uri;
    const bytes = atob(uri.slice(uri.indexOf(',') + 1)).length;
    expect(bytes).toBe(gltf.buffers[0].byteLength);
    const p0 = parts[0]!;
    expect(gltf.nodes[0].scale[0]).toBeCloseTo((p0.bounds.width / inches(1)) * 0.0254, 6);
    expect(gltf.nodes[0].extras.partId).toBe(p0.id);
  });
});

describe('3D exports of mitered parts', () => {
  // A doorway in the base tier with the toe kick mitered around its open ends.
  const p = createDefaultProject();
  const run = p.runs[0]!;
  const gap = { id: 'door', kind: 'gap' as const, x: { anchor: 'center' as const, offset: 0 }, width: inches(36), tiers: { from: run.tiers[0]!.id, to: run.tiers[0]!.id }, content: { kind: 'opening' as const, id: 'o', front: { type: 'none' as const }, adjustableShelves: 0 } };
  run.spans.push(gap);
  run.tiers[0]!.items.splice(2, 0, { kind: 'slot', spanId: 'door' });
  run.tiers[0]!.toeKick = { ...run.tiers[0]!.toeKick!, mitreOpenEnds: true };
  const all = deriveRun(p, run.id).parts;
  const mitred = all.filter((q) => q.mitres?.length);
  const front = mitred.find((q) => q.id.endsWith('kick-0-front'))!;

  it('has mitered toe kick parts to export', () => {
    expect(mitred.length).toBe(4); // two front board ends, two returns
  });

  it('cuts the miter in OBJ vertices', () => {
    const obj = toOBJ([front], 'imperial');
    const xs = obj.split('\n').filter((l) => l.startsWith('v ')).map((l) => Number(l.split(' ')[1]));
    const b = front.bounds;
    const x1 = (b.x + b.width) / inches(1);
    // The outer (front) corners reach the end; the inner (back) corners stop a board thickness short.
    expect(xs.filter((x) => Math.abs(x - x1) < 1e-4)).toHaveLength(2);
    expect(xs.filter((x) => Math.abs(x - (x1 - b.depth / inches(1))) < 1e-4)).toHaveLength(2);
  });

  it('gives the STL miter face a diagonal normal', () => {
    const view = new DataView(toSTL([front]));
    const normals = Array.from({ length: 12 }, (_, t) => [0, 1, 2].map((k) => view.getFloat32(84 + t * 50 + k * 4, true)));
    // The miter face faces the return: back and to the right.
    expect(normals.some(([x, y, z]) => Math.abs(x! - Math.SQRT1_2) < 1e-4 && Math.abs(y!) < 1e-6 && Math.abs(z! + Math.SQRT1_2) < 1e-4)).toBe(true);
  });

  it('gives mitered parts their own glTF mesh, in place', () => {
    const gltf = JSON.parse(toGLTF(all, p.materials));
    const looks = new Set(all.map((q) => q.materialId)).size;
    expect(gltf.meshes).toHaveLength(looks + mitred.length);
    const i = all.indexOf(front);
    const node = gltf.nodes[i];
    expect(node.scale).toBeUndefined();
    expect(node.mesh).toBeGreaterThanOrEqual(looks);
    const pos = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
    expect(pos.count).toBe(24);
    expect(pos.max[0]).toBeCloseTo(((front.bounds.x + front.bounds.width) / inches(1)) * 0.0254, 5);
    const uri: string = gltf.buffers[0].uri;
    expect(atob(uri.slice(uri.indexOf(',') + 1)).length).toBe(gltf.buffers[0].byteLength);
  });
});
