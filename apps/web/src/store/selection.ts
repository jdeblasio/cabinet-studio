import {
  findBox,
  findSectionInRun,
  findSpan,
  findTier,
  sectionPath,
  type Id,
  type Project,
  type Run,
  type RunResult,
} from '@cabinet-studio/engine';

export type Selection =
  | { kind: 'run'; runId: Id }
  | { kind: 'tier'; runId: Id; tierId: Id }
  | { kind: 'box'; runId: Id; boxId: Id }
  | { kind: 'span'; runId: Id; spanId: Id }
  /** A split or opening inside a box or span's face layout. */
  | { kind: 'section'; runId: Id; ownerId: Id; sectionId: Id };

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (!a || !b) return a === b;
  return selectionKey(a) === selectionKey(b);
}

export function selectionKey(s: Selection): string {
  switch (s.kind) {
    case 'run':
      return `run:${s.runId}`;
    case 'tier':
      return `tier:${s.tierId}`;
    case 'box':
      return `box:${s.boxId}`;
    case 'span':
      return `span:${s.spanId}`;
    case 'section':
      return `section:${s.sectionId}`;
  }
}

export function validSelection(project: Project, s: Selection): boolean {
  const run = project.runs.find((r) => r.id === s.runId);
  if (!run) return false;
  switch (s.kind) {
    case 'run':
      return true;
    case 'tier':
      return !!findTier(run, s.tierId);
    case 'box':
      return !!findBox(run, s.boxId);
    case 'span':
      return !!findSpan(run, s.spanId);
    case 'section':
      return findSectionInRun(run, s.sectionId)?.owner.id === s.ownerId;
  }
}

/** The element that owns a section/box (box or span id), if any. */
export function selectionOwnerId(s: Selection | null): Id | undefined {
  if (!s) return undefined;
  if (s.kind === 'box') return s.boxId;
  if (s.kind === 'span') return s.spanId;
  if (s.kind === 'section') return s.ownerId;
  return undefined;
}

/** Selection for a box-or-span owner id. */
export function ownerSelection(run: Run, ownerId: Id): Selection | null {
  if (findBox(run, ownerId)) return { kind: 'box', runId: run.id, boxId: ownerId };
  if (findSpan(run, ownerId)) return { kind: 'span', runId: run.id, spanId: ownerId };
  return null;
}

/** Map any model id (run, tier, box, span, section) to a selection. */
export function selectionForId(run: Run, id: Id, result?: RunResult): Selection {
  if (id === run.id) return { kind: 'run', runId: run.id };
  if (findTier(run, id)) return { kind: 'tier', runId: run.id, tierId: id };
  const owner = ownerSelection(run, id);
  if (owner) return owner;
  const sec = findSectionInRun(run, id);
  if (sec) return { kind: 'section', runId: run.id, ownerId: sec.owner.id, sectionId: id };
  const frame = result?.frames.find((f) => f.id === id);
  if (frame?.boxIds[0]) {
    const s = ownerSelection(run, frame.boxIds[0]);
    if (s) return s;
  }
  return { kind: 'run', runId: run.id };
}

/**
 * One level up from the current selection:
 * section → parent split → … → box/span → tier → run.
 */
export function parentSelection(run: Run, s: Selection): Selection | null {
  switch (s.kind) {
    case 'run':
      return null;
    case 'tier':
      return { kind: 'run', runId: run.id };
    case 'box': {
      const hit = findBox(run, s.boxId);
      return hit ? { kind: 'tier', runId: run.id, tierId: hit.tier.id } : { kind: 'run', runId: run.id };
    }
    case 'span': {
      const span = findSpan(run, s.spanId);
      return span ? { kind: 'tier', runId: run.id, tierId: span.tiers.from } : { kind: 'run', runId: run.id };
    }
    case 'section': {
      const owner = findSectionInRun(run, s.sectionId)?.owner;
      if (!owner) return { kind: 'run', runId: run.id };
      const path = sectionPath(owner.content, s.sectionId);
      const parentId = path[path.length - 2];
      if (parentId) return { kind: 'section', runId: run.id, ownerId: owner.id, sectionId: parentId };
      return ownerSelection(run, owner.id);
    }
  }
}
