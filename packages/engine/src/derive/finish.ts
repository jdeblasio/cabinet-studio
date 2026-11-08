/**
 * Finishes (paint) on derived parts: each part takes the finish set for its material slot in the
 * settings that apply to it (its box's, or its tier's or run's for parts outside boxes).
 */
import { finishesOf, NATURAL } from '../defaults';
import type { Part, PartRole } from '../derived';
import type { ConstructionSettings, Finish, MaterialSlot, Project } from '../model';

/** The material slot each kind of part comes from. Fillers depend on their material. */
const ROLE_SLOT: Partial<Record<PartRole, MaterialSlot>> = {
  side: 'carcass',
  top: 'carcass',
  bottom: 'carcass',
  partition: 'carcass',
  back: 'back',
  fixedShelf: 'shelves',
  adjustableShelf: 'shelves',
  stile: 'faceFrame',
  rail: 'faceFrame',
  door: 'fronts',
  drawerFront: 'fronts',
  toeKick: 'toeKick',
  countertop: 'countertop',
  drawerBox: 'drawerBox',
  drawerBottom: 'drawerBottom',
  frontFrame: 'frontFrame',
  frontPanel: 'frontPanel',
  molding: 'molding',
};

/** Which material slot a part was made from. */
export function slotOf(part: Pick<Part, 'role' | 'materialId'>, s: ConstructionSettings): MaterialSlot {
  const slot = ROLE_SLOT[part.role];
  if (slot) return slot;
  // Fillers: scribe strips are face frame stock, frameless wall fillers are front stock.
  return part.materialId === s.materials.faceFrame ? 'faceFrame' : part.materialId === s.materials.fronts ? 'fronts' : 'carcass';
}

/** Set each part's finish from the settings that apply to it (`settingsFor` its owner). */
export function applyFinishes(parts: Part[], settingsFor: (ownerId: string) => ConstructionSettings): void {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const s = settingsFor(p.ownerId);
    const f = s.finishes?.[slotOf(p, s)];
    if (f && f !== NATURAL) parts[i] = { ...p, finishId: f };
  }
}

/** A part's display color: its finish's color, else its material's. */
export function partColor(project: Pick<Project, 'materials' | 'finishes'>, part: Pick<Part, 'materialId' | 'finishId'>, fallback = '#cccccc'): string {
  if (part.finishId) {
    const f = finishesOf(project).find((ff) => ff.id === part.finishId);
    if (f) return f.color;
  }
  return project.materials.find((m) => m.id === part.materialId)?.color ?? fallback;
}

/** The finish on a part, if it has one the project knows. */
export function finishOf(project: Pick<Project, 'finishes'>, finishId: string | undefined): Finish | undefined {
  return finishId ? finishesOf(project).find((f) => f.id === finishId) : undefined;
}
