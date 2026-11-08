/** Collecting derived parts (with their run and owner) for the cut list. */
import type { Issue, Part, PartRole, RunResult } from '../derived';
import type { Id, Material, Project } from '../model';
import { TICKS_PER_INCH, type Ticks } from '../units';

/** A derived part as the cut list sees it: the part plus where it came from. */
export interface PartRef {
  /** Unique across the project: `${runId}:${partId}`. */
  key: string;
  partId: Id;
  runId: Id;
  /** Box, span or tier the part belongs to (Part.ownerId). */
  ownerId: Id;
  name: string;
  role: PartRole;
  materialId: Id;
  /** Along the grain. */
  length: Ticks;
  /** Across the grain. */
  width: Ticks;
  thickness: Ticks;
  /** Why the cut size differs from the visible size (Part.note). */
  note?: string;
}

/** A model element that owns parts, with a readable label. */
export interface PartOwner {
  runId: Id;
  ownerId: Id;
  /** e.g. "Base 2", "Tall box 1", or the box's own name. Prefixed with the run name when the project has several runs. */
  label: string;
}

/** Issue raised by the cut list / optimizer. `runId` and `partKeys` help the UI locate it. */
export interface CutIssue extends Issue {
  runId?: Id;
  partKeys?: string[];
}

export function partRef(runId: Id, p: Part): PartRef {
  return {
    key: `${runId}:${p.id}`,
    partId: p.id,
    runId,
    ownerId: p.ownerId,
    name: p.name,
    role: p.role,
    materialId: p.materialId,
    length: Math.round(p.length),
    width: Math.round(p.width),
    thickness: Math.round(p.thickness),
    ...(p.note ? { note: p.note } : {}),
  };
}

/** Every part of every run, in derivation order. */
export function collectParts(results: readonly RunResult[]): PartRef[] {
  const out: PartRef[] = [];
  for (const r of results) for (const p of r.parts) out.push(partRef(r.runId, p));
  return out;
}

/** Readable labels for every box, span and tier in the project, keyed by `${runId}:${ownerId}`. */
export function ownerLabels(project: Project): Map<string, PartOwner> {
  const out = new Map<string, PartOwner>();
  const multi = project.runs.length > 1;
  for (const run of project.runs) {
    const pre = multi ? `${run.name}: ` : '';
    const add = (ownerId: Id, label: string) => out.set(`${run.id}:${ownerId}`, { runId: run.id, ownerId, label: pre + label });
    for (const tier of run.tiers) {
      add(tier.id, tier.name);
      let n = 0;
      for (const item of tier.items) {
        if (item.kind !== 'box') continue;
        n++;
        add(item.id, item.name?.trim() || `${tier.name} ${n}`);
      }
    }
    let tall = 0;
    let gap = 0;
    for (const span of run.spans) {
      const n = span.kind === 'box' ? ++tall : ++gap;
      add(span.id, span.name?.trim() || `${span.kind === 'box' ? 'Tall box' : 'Gap'} ${n}`);
    }
  }
  return out;
}

export function ownerOf(labels: ReadonlyMap<string, PartOwner>, p: PartRef): PartOwner {
  return labels.get(`${p.runId}:${p.ownerId}`) ?? { runId: p.runId, ownerId: p.ownerId, label: p.ownerId };
}

export const materialById = (project: Project, id: Id): Material | undefined => project.materials.find((m) => m.id === id);

/** Square ticks → square feet. */
export const sqft = (area: number): number => area / (TICKS_PER_INCH * TICKS_PER_INCH * 144);

/** Board feet of a piece of lumber (thickness × width × length in inches / 144). */
export function boardFeet(thickness: Ticks, width: Ticks, length: Ticks): number {
  const i = TICKS_PER_INCH;
  return ((thickness / i) * (width / i) * (length / i)) / 144;
}
