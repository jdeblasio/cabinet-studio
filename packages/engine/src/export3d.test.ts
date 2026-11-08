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
