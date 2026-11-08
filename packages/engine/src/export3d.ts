/**
 * 3D model exports of derived parts (every part is an axis-aligned box in run space:
 * x along the run, y up, z out from the wall; mitered ends are cut at 45°).
 *  - glTF 2.0 (.gltf, JSON with an embedded buffer): one unit-cube mesh per material, one node
 *    per part scaled and placed; mitered parts get their own mesh. Meters, y up, as glTF requires.
 *  - OBJ (.obj): one object per part, in inches or millimeters.
 *  - STL (.stl, binary): all parts as one solid, in millimeters (the usual STL convention).
 */
import type { EdgeFace, Mitre, Part } from './derived';
import type { Finish, Material } from './model';
import { TICKS_PER_INCH, TICKS_PER_MM, type Ticks, type UnitSystem } from './units';

type Vec3 = [number, number, number];

const FACE_AXIS: Record<EdgeFace, { axis: 0 | 1 | 2; sign: 1 | -1 }> = {
  left: { axis: 0, sign: -1 },
  right: { axis: 0, sign: 1 },
  bottom: { axis: 1, sign: -1 },
  top: { axis: 1, sign: 1 },
  back: { axis: 2, sign: -1 },
  front: { axis: 2, sign: 1 },
};

/** Corner signs: x0y0z0, x1y0z0, x1y1z0, x0y1z0, then the same at z1. */
const CORNER_SIGNS: readonly Vec3[] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

/**
 * The 8 corners of a block with its min corner at `origin` and `size` along x, y, z (any unit),
 * in the order BLOCK_FACES uses. Each mitered end has its inside corners pulled back by the
 * block's size across the miter: a 45° cut with its long point on the outer face.
 */
export function blockCorners(origin: Vec3, size: Vec3, mitres: readonly Mitre[] = []): Vec3[] {
  return CORNER_SIGNS.map((s) => {
    const p: Vec3 = [origin[0] + (s[0] > 0 ? size[0] : 0), origin[1] + (s[1] > 0 ? size[1] : 0), origin[2] + (s[2] > 0 ? size[2] : 0)];
    for (const m of mitres) {
      const f = FACE_AXIS[m.face];
      const o = FACE_AXIS[m.outer];
      if (f.axis === o.axis) continue;
      if (s[f.axis] === f.sign && s[o.axis] === -o.sign) p[f.axis] -= f.sign * size[o.axis];
    }
    return p;
  });
}

/** The 8 corners of a part (mitered ends cut), in the given unit (ticks per unit). */
function corners(p: Part, perUnit: number): Vec3[] {
  const b = p.bounds;
  return blockCorners([b.x / perUnit, b.y / perUnit, b.z / perUnit], [b.width / perUnit, b.height / perUnit, b.depth / perUnit], p.mitres);
}

/** Unit normal of the triangle a, b, c (counter-clockwise from outside), or null if it's degenerate. */
export function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n);
  return len > 1e-12 ? [n[0] / len, n[1] / len, n[2] / len] : null;
}

/** Box faces as corner-index quads, counter-clockwise seen from outside, with outward normals. */
export const BLOCK_FACES: { quad: [number, number, number, number]; normal: [number, number, number] }[] = [
  { quad: [0, 3, 2, 1], normal: [0, 0, -1] }, // back (z0)
  { quad: [4, 5, 6, 7], normal: [0, 0, 1] }, // front (z1)
  { quad: [0, 4, 7, 3], normal: [-1, 0, 0] }, // left (x0)
  { quad: [1, 2, 6, 5], normal: [1, 0, 0] }, // right (x1)
  { quad: [0, 1, 5, 4], normal: [0, -1, 0] }, // bottom (y0)
  { quad: [3, 7, 6, 2], normal: [0, 1, 0] }, // top (y1)
];

const fmtNum = (n: number) => String(Math.round(n * 1e5) / 1e5);

/** OBJ text: one object per part, named after it; lengths in the project's units (inches or mm). */
export function toOBJ(parts: readonly Part[], system: UnitSystem, title = 'Built-in Planner export'): string {
  const perUnit = system === 'metric' ? TICKS_PER_MM : TICKS_PER_INCH;
  const lines = [`# ${title}`, `# Units: ${system === 'metric' ? 'millimeters' : 'inches'}, y up`];
  let base = 1;
  for (const p of parts) {
    lines.push(`o ${p.name.replace(/\s+/g, '_')}_${p.id.replace(/[^A-Za-z0-9-]/g, '_').slice(-24)}`);
    for (const c of corners(p, perUnit)) lines.push(`v ${c.map(fmtNum).join(' ')}`);
    for (const f of BLOCK_FACES) lines.push(`f ${f.quad.map((i) => i + base).join(' ')}`);
    base += 8;
  }
  return lines.join('\n') + '\n';
}

/** Binary STL of all parts, in millimeters. */
export function toSTL(parts: readonly Part[]): ArrayBuffer {
  const triangles = parts.length * 12;
  const buf = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buf);
  const header = 'Built-in Planner export, millimeters';
  for (let i = 0; i < header.length && i < 80; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, triangles, true);
  let o = 84;
  for (const p of parts) {
    const c = corners(p, TICKS_PER_MM);
    for (const f of BLOCK_FACES) {
      const [a, b, d, e] = f.quad;
      for (const tri of [
        [a, b, d],
        [a, d, e],
      ] as const) {
        // The facet's own normal (a mitered face is diagonal); the face's if the facet is degenerate.
        const normal = triangleNormal(c[tri[0]]!, c[tri[1]]!, c[tri[2]]!) ?? f.normal;
        for (const n of normal) {
          view.setFloat32(o, n, true);
          o += 4;
        }
        for (const vi of tri) {
          for (const coord of c[vi]!) {
            view.setFloat32(o, coord, true);
            o += 4;
          }
        }
        view.setUint16(o, 0, true);
        o += 2;
      }
    }
  }
  return buf;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function colorOf(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const v = m ? parseInt(m[1]!, 16) : 0xcccccc;
  return [srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255), 1];
}

/**
 * glTF 2.0 JSON (embedded buffer). A unit cube (flat-shaded: 24 vertices, 36 indices) is shared
 * by one mesh per material; each part is a node that scales and places it. Meters, y up.
 */
export function toGLTF(parts: readonly Part[], materials: readonly Material[], title = 'Built-in Planner export', finishes: readonly Finish[] = []): string {
  const toMeters = (t: Ticks) => (t / TICKS_PER_INCH) * 0.0254;
  const perMeter = TICKS_PER_INCH / 0.0254;

  // Unit cube from 0 to 1 on each axis, shared by every square-ended part.
  const unitPositions: number[] = [];
  const unitNormals: number[] = [];
  const indices: number[] = [];
  for (const f of BLOCK_FACES) {
    const start = unitPositions.length / 3;
    for (const ci of f.quad) {
      unitPositions.push(...CORNER_SIGNS[ci]!.map((sgn) => (sgn > 0 ? 1 : 0)));
      unitNormals.push(...f.normal);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  // Mitered parts get their own geometry (a cube can't be scaled into a 45° cut), in place, in meters.
  const mitred = parts.map((p, i) => ({ p, i })).filter(({ p }) => p.mitres?.length);
  const mitredData = mitred.map(({ p }) => {
    const c = corners(p, perMeter);
    const pos: number[] = [];
    const nor: number[] = [];
    for (const f of BLOCK_FACES) {
      const [a, b, d] = f.quad;
      const n = triangleNormal(c[a]!, c[b]!, c[d]!) ?? triangleNormal(c[a]!, c[d]!, c[f.quad[3]]!) ?? f.normal;
      for (const ci of f.quad) {
        pos.push(...c[ci]!);
        nor.push(...n);
      }
    }
    const min = [0, 1, 2].map((k) => Math.min(...c.map((v) => v[k]!)));
    const max = [0, 1, 2].map((k) => Math.max(...c.map((v) => v[k]!)));
    return { pos: new Float32Array(pos), nor: new Float32Array(nor), min, max };
  });

  // The binary buffer: the cube's positions, normals and indices, then each mitered part's positions and normals.
  const chunks: Uint8Array[] = [];
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number; target: number }[] = [];
  let offset = 0;
  const addView = (bytes: ArrayBufferView, target: number) => {
    const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    chunks.push(u8);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: u8.byteLength, target });
    offset += u8.byteLength;
    return bufferViews.length - 1;
  };
  const accessors: Record<string, unknown>[] = [
    { bufferView: addView(new Float32Array(unitPositions), 34962), componentType: 5126, count: unitPositions.length / 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] },
    { bufferView: addView(new Float32Array(unitNormals), 34962), componentType: 5126, count: unitNormals.length / 3, type: 'VEC3' },
    { bufferView: addView(new Uint16Array(indices), 34963), componentType: 5123, count: indices.length, type: 'SCALAR' },
  ];
  const mitredAccessors = mitredData.map((m) => {
    accessors.push({ bufferView: addView(m.pos, 34962), componentType: 5126, count: m.pos.length / 3, type: 'VEC3', min: m.min, max: m.max });
    accessors.push({ bufferView: addView(m.nor, 34962), componentType: 5126, count: m.nor.length / 3, type: 'VEC3' });
    return { position: accessors.length - 2, normal: accessors.length - 1 };
  });
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    bin.set(c, at);
    at += c.byteLength;
  }

  // One glTF material per look: a painted part takes its finish, the rest their material.
  const finishById = new Map(finishes.map((f) => [f.id, f]));
  const lookOf = (p: Part) => (p.finishId && finishById.has(p.finishId) ? `finish:${p.finishId}` : p.materialId);
  const usedMaterials = [...new Set(parts.map(lookOf))];
  const matIndex = new Map(usedMaterials.map((id, i) => [id, i]));
  const describe = (look: string) => {
    if (look.startsWith('finish:')) {
      const f = finishById.get(look.slice('finish:'.length))!;
      return { name: f.name, color: f.color };
    }
    const m = materials.find((mm) => mm.id === look);
    return { name: m?.name ?? look, color: m?.color ?? '#cccccc' };
  };

  // Meshes: one shared cube per look, then one per mitered part.
  const meshes = usedMaterials.map((id, i) => ({ name: describe(id).name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: i }] }));
  const mitredMesh = new Map<number, number>();
  mitred.forEach(({ p, i }, k) => {
    meshes.push({ name: p.name, primitives: [{ attributes: { POSITION: mitredAccessors[k]!.position, NORMAL: mitredAccessors[k]!.normal }, indices: 2, material: matIndex.get(lookOf(p)) ?? 0 }] });
    mitredMesh.set(i, meshes.length - 1);
  });

  const gltf = {
    asset: { version: '2.0', generator: 'Built-in Planner' },
    scene: 0,
    scenes: [{ name: title, nodes: parts.map((_, i) => i) }],
    nodes: parts.map((p, i) => {
      const own = mitredMesh.get(i);
      const extras = { partId: p.id, role: p.role };
      if (own !== undefined) return { name: p.name, mesh: own, extras };
      return {
        name: p.name,
        mesh: matIndex.get(lookOf(p)) ?? 0,
        translation: [toMeters(p.bounds.x), toMeters(p.bounds.y), toMeters(p.bounds.z)],
        scale: [Math.max(toMeters(p.bounds.width), 1e-6), Math.max(toMeters(p.bounds.height), 1e-6), Math.max(toMeters(p.bounds.depth), 1e-6)],
        extras,
      };
    }),
    meshes,
    materials: usedMaterials.map((id) => {
      const d = describe(id);
      return { name: d.name, pbrMetallicRoughness: { baseColorFactor: colorOf(d.color), metallicFactor: 0, roughnessFactor: 0.85 } };
    }),
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.byteLength, uri: `data:application/octet-stream;base64,${base64(bin)}` }],
  };
  return JSON.stringify(gltf);
}
