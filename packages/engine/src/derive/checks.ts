/**
 * Engineering checks.
 *
 * Shelf sag: a shelf is treated as a simply supported beam under a uniform load (conservative for
 * shelves fixed at their ends), deflecting δ = 5wL⁴ / (384 E I) with I = b h³ / 12. The load is
 * `shelves.designLoad` pounds per square foot of shelf (20 psf, roughly a shelf of books, by
 * default). Sag beyond `shelves.maxSagPerFoot` inches per foot of span (0.02"/ft, the usual
 * "visible sag" threshold) is flagged. Stiffness E comes from the material, defaulting to
 * 1,000,000 psi for sheet goods (plywood) and 1,400,000 psi for lumber.
 */
import type { ConstructionSettings, Id, Material } from '../model';
import { TICKS_PER_INCH, type Ticks } from '../units';
import type { Ctx } from './context';

export const DEFAULT_MODULUS = { sheet: 1_000_000, lumber: 1_400_000 } as const;

export function modulusOf(material: Material | undefined): number {
  return material?.modulus ?? DEFAULT_MODULUS[material?.kind ?? 'sheet'];
}

/**
 * Midspan sag in inches for a shelf of this span, depth and thickness (all ticks). `extraEI`
 * (lb·in²) adds the stiffness of something fastened along it, e.g. a solid wood nosing (summed
 * about each piece's own axis, which underestimates the pair a little: conservative).
 */
export function shelfSag(span: Ticks, depth: Ticks, thickness: Ticks, loadPsf: number, modulusPsi: number, extraEI = 0): number {
  const L = span / TICKS_PER_INCH;
  const b = depth / TICKS_PER_INCH;
  const h = thickness / TICKS_PER_INCH;
  if (L <= 0 || b <= 0 || h <= 0 || modulusPsi <= 0) return 0;
  const w = (loadPsf * b) / 144; // lb per inch of span
  const I = (b * h ** 3) / 12;
  return (5 * w * L ** 4) / (384 * (modulusPsi * I + extraEI));
}

/** Bending stiffness E·I (lb·in²) of a strip `width` wide (along the load) and `height` deep, standing on edge. */
export function stripEI(width: Ticks, height: Ticks, material: Material | undefined): number {
  const b = width / TICKS_PER_INCH;
  const h = height / TICKS_PER_INCH;
  return modulusOf(material) * ((b * h ** 3) / 12);
}

/** Warn when a shelf would sag visibly under the design load. */
export function checkShelfSag(ctx: Ctx, s: ConstructionSettings, sourceId: Id, label: string, materialId: Id, span: Ticks, depth: Ticks, thickness: Ticks, extraEI = 0): void {
  const material = ctx.project.materials.find((m) => m.id === materialId);
  const sag = shelfSag(span, depth, thickness, s.shelves.designLoad, modulusOf(material), extraEI);
  const limit = (s.shelves.maxSagPerFoot * span) / TICKS_PER_INCH / 12;
  if (sag <= limit) return;
  const shown = sag >= 0.1 ? sag.toFixed(2) : sag.toFixed(3);
  ctx.issue(
    'warning',
    'shelf-sag',
    sourceId,
    `${label} spanning ${ctx.fmt(span)} would sag about ${shown}" under ${s.shelves.designLoad} lb/ft² (limit ${limit.toFixed(3)}"). Shorten the span, add a divider, or use a thicker or stiffer shelf.`,
  );
}
