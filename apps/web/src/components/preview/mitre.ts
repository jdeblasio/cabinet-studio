/**
 * Geometry for mitered parts: a block whose mitered ends are cut at 45°, so two parts meeting
 * at an outside corner (e.g. a toe kick front board and its return) show one clean corner
 * instead of overlapping blocks. The corners come from the engine (shared with the 3D exports).
 */
import { BLOCK_FACES, blockCorners, type Mitre } from '@built-in-planner/engine';
import { BufferGeometry, Float32BufferAttribute } from 'three';

/** The block's 8 corners, centered on the origin (`size` = width, height, depth), mitered ends cut. */
export function mitredCorners(size: readonly [number, number, number], mitres: readonly Mitre[]): [number, number, number][] {
  return blockCorners([-size[0] / 2, -size[1] / 2, -size[2] / 2], [size[0], size[1], size[2]], mitres);
}

/** A flat-shaded block with mitered ends. */
export function mitredBoxGeometry(size: readonly [number, number, number], mitres: readonly Mitre[]): BufferGeometry {
  const c = mitredCorners(size, mitres);
  const positions: number[] = [];
  for (const { quad } of BLOCK_FACES) {
    const [a, b, d, e] = quad;
    for (const i of [a, b, d, a, d, e]) positions.push(...c[i]!);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}
