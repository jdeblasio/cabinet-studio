/**
 * 3D model exports of derived parts (every part is an axis-aligned box in run space:
 * x along the run, y up, z out from the wall).
 *  - glTF 2.0 (.gltf, JSON with an embedded buffer): one unit-cube mesh per material, one node
 *    per part scaled and placed. Meters, y up, as glTF requires.
 *  - OBJ (.obj): one object per part, in inches or millimeters.
 *  - STL (.stl, binary): all parts as one solid, in millimeters (the usual STL convention).
 */
import type { Part } from './derived';
import type { Material } from './model';
import { TICKS_PER_INCH, TICKS_PER_MM, type Ticks, type UnitSystem } from './units';

/** The 8 corners of a part's bounds, in the given unit (ticks per unit). */
function corners(p: Part, perUnit: number): [number, number, number][] {
  const b = p.bounds;
  const x0 = b.x / perUnit;
  const y0 = b.y / perUnit;
  const z0 = b.z / perUnit;
  const x1 = (b.x + b.width) / perUnit;
  const y1 = (b.y + b.height) / perUnit;
  const z1 = (b.z + b.depth) / perUnit;
  return [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
}

/** Box faces as corner-index quads, counter-clockwise seen from outside, with outward normals. */
const FACES: { quad: [number, number, number, number]; normal: [number, number, number] }[] = [
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
    for (const f of FACES) lines.push(`f ${f.quad.map((i) => i + base).join(' ')}`);
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
    for (const f of FACES) {
      const [a, b, d, e] = f.quad;
      for (const tri of [
        [a, b, d],
        [a, d, e],
      ] as const) {
        for (const n of f.normal) {
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
export function toGLTF(parts: readonly Part[], materials: readonly Material[], title = 'Built-in Planner export'): string {
  // Unit cube from 0 to 1 on each axis.
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const unit: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  for (const f of FACES) {
    const start = positions.length / 3;
    for (const ci of f.quad) {
      positions.push(...unit[ci]!);
      normals.push(...f.normal);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const posBytes = new Float32Array(positions);
  const normBytes = new Float32Array(normals);
  const idxBytes = new Uint16Array(indices);
  const bin = new Uint8Array(posBytes.byteLength + normBytes.byteLength + idxBytes.byteLength);
  bin.set(new Uint8Array(posBytes.buffer), 0);
  bin.set(new Uint8Array(normBytes.buffer), posBytes.byteLength);
  bin.set(new Uint8Array(idxBytes.buffer), posBytes.byteLength + normBytes.byteLength);

  const usedMaterials = [...new Set(parts.map((p) => p.materialId))];
  const matIndex = new Map(usedMaterials.map((id, i) => [id, i]));
  const toMeters = (t: Ticks) => (t / TICKS_PER_INCH) * 0.0254;

  const gltf = {
    asset: { version: '2.0', generator: 'Built-in Planner' },
    scene: 0,
    scenes: [{ name: title, nodes: parts.map((_, i) => i) }],
    nodes: parts.map((p) => ({
      name: p.name,
      mesh: matIndex.get(p.materialId) ?? 0,
      translation: [toMeters(p.bounds.x), toMeters(p.bounds.y), toMeters(p.bounds.z)],
      scale: [Math.max(toMeters(p.bounds.width), 1e-6), Math.max(toMeters(p.bounds.height), 1e-6), Math.max(toMeters(p.bounds.depth), 1e-6)],
      extras: { partId: p.id, role: p.role },
    })),
    meshes: usedMaterials.map((id, i) => ({
      name: materials.find((m) => m.id === id)?.name ?? id,
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: i }],
    })),
    materials: usedMaterials.map((id) => {
      const m = materials.find((mm) => mm.id === id);
      return { name: m?.name ?? id, pbrMetallicRoughness: { baseColorFactor: colorOf(m?.color ?? '#cccccc'), metallicFactor: 0, roughnessFactor: 0.85 } };
    }),
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posBytes.byteLength, byteLength: normBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posBytes.byteLength + normBytes.byteLength, byteLength: idxBytes.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: bin.byteLength, uri: `data:application/octet-stream;base64,${base64(bin)}` }],
  };
  return JSON.stringify(gltf);
}
