import {
  findBox,
  findSectionInRun,
  findTier,
  setBoxWidth,
  setSplitChildSize,
  setTierHeight,
  type Id,
  type Project,
  type Rect,
  type Run,
  type RunResult,
  type SizeSpec,
  type Ticks,
} from '@built-in-planner/engine';
import type { Selection } from '../../store/selection';

const contains = (r: Rect, x: Ticks, y: Ticks) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/**
 * Selections under a point, most specific first:
 * opening → enclosing splits → box/span → tier → run.
 */
export function hitChain(run: Run, result: RunResult, x: Ticks, y: Ticks): Selection[] {
  const chain: Selection[] = [];
  const runId = run.id;
  const box = result.boxes.find((b) => contains({ x: b.carcass.x, y: b.carcass.y, width: b.carcass.width, height: b.carcass.height }, x, y));
  if (box) {
    // Sections are flattened parents-first, so the last one containing the point is the deepest.
    const containing = box.sections.filter((s) => contains(s.rect, x, y));
    const deepest = containing[containing.length - 1];
    const byId = new Map(box.sections.map((s) => [s.sectionId, s]));
    for (let s = deepest; s; s = s.parentId ? byId.get(s.parentId) : undefined) {
      chain.push({ kind: 'section', runId, ownerId: box.id, sectionId: s.sectionId });
    }
    chain.push(box.source === 'span' ? { kind: 'span', runId, spanId: box.id } : { kind: 'box', runId, boxId: box.id });
  } else {
    const gap = result.gaps.find((g) => contains(g.rect, x, y));
    if (gap) chain.push({ kind: 'span', runId, spanId: gap.spanId });
  }
  const tier = result.tiers.find((t) => y >= t.y && y <= t.y + t.height);
  if (tier && x >= 0 && x <= result.width) chain.push({ kind: 'tier', runId, tierId: tier.tierId });
  chain.push({ kind: 'run', runId });
  return chain;
}

/** Rectangle (in run elevation space) representing a selection, if it has one. */
export function selectionRect(result: RunResult, s: Selection): Rect | undefined {
  switch (s.kind) {
    case 'run':
      return { x: 0, y: 0, width: result.width, height: result.ceilingHeight };
    case 'tier': {
      const t = result.tiers.find((tl) => tl.tierId === s.tierId);
      return t && { x: 0, y: t.y, width: result.width, height: t.height };
    }
    case 'box':
    case 'span': {
      const id = s.kind === 'box' ? s.boxId : s.spanId;
      const b = result.boxes.find((bl) => bl.id === id);
      if (b) return { x: b.carcass.x, y: b.carcass.y, width: b.carcass.width, height: b.carcass.height };
      return result.gaps.find((g) => g.spanId === id)?.rect;
    }
    case 'section': {
      const b = result.boxes.find((bl) => bl.id === s.ownerId);
      return b?.sections.find((sl) => sl.sectionId === s.sectionId)?.rect;
    }
  }
}

export interface BoundaryHandle {
  key: string;
  /** 'x': a vertical line dragged left/right. 'y': a horizontal line dragged up/down. */
  axis: 'x' | 'y';
  /** Line position along the drag axis, and its extent along the other axis. */
  pos: Ticks;
  from: Ticks;
  to: Ticks;
  /** delta applied to `a` = sign × world-space movement along the axis. */
  sign: 1 | -1;
  a: { spec: SizeSpec; size: Ticks };
  b: { spec: SizeSpec; size: Ticks };
  minSize: Ticks;
  apply: (draft: Project, a: SizeSpec, b: SizeSpec) => void;
}

const inRun = (draft: Project, runId: Id): Run | undefined => draft.runs.find((r) => r.id === runId);

export function computeHandles(run: Run, result: RunResult, minSize: Ticks): BoundaryHandle[] {
  const handles: BoundaryHandle[] = [];
  const runId = run.id;

  // Between boxes within a tier (not across span slots: spans have fixed geometry).
  for (const tl of result.tiers) {
    const tier = findTier(run, tl.tierId);
    if (!tier || tier.kind !== 'boxes') continue;
    for (let i = 0; i + 1 < tl.items.length; i++) {
      const ia = tl.items[i]!;
      const ib = tl.items[i + 1]!;
      if (ia.kind !== 'box' || ib.kind !== 'box') continue;
      const ba = findBox(run, ia.id)?.box;
      const bb = findBox(run, ib.id)?.box;
      if (!ba || !bb) continue;
      handles.push({
        key: `items:${ia.id}|${ib.id}`,
        axis: 'x',
        pos: ia.x + ia.width,
        from: tl.y + tl.toeKick,
        to: tl.y + tl.height,
        sign: 1,
        a: { spec: ba.width, size: ia.width },
        b: { spec: bb.width, size: ib.width },
        minSize,
        apply: (draft, a, b) => {
          const r = inRun(draft, runId);
          if (!r) return;
          setBoxWidth(r, ia.id, a);
          setBoxWidth(r, ib.id, b);
        },
      });
    }
  }

  // Between tiers.
  for (let i = 0; i + 1 < result.tiers.length; i++) {
    const la = result.tiers[i]!;
    const lb = result.tiers[i + 1]!;
    const ta = findTier(run, la.tierId);
    const tb = findTier(run, lb.tierId);
    if (!ta || !tb) continue;
    handles.push({
      key: `tiers:${la.tierId}|${lb.tierId}`,
      axis: 'y',
      pos: la.y + la.height,
      from: 0,
      to: result.width,
      sign: 1,
      a: { spec: ta.height, size: la.height },
      b: { spec: tb.height, size: lb.height },
      minSize,
      apply: (draft, a, b) => {
        const r = inRun(draft, runId);
        if (!r) return;
        setTierHeight(r, la.tierId, a);
        setTierHeight(r, lb.tierId, b);
      },
    });
  }

  // Between children of splits.
  for (const bl of result.boxes) {
    const layoutById = new Map(bl.sections.map((s) => [s.sectionId, s]));
    for (const sl of bl.sections) {
      if (sl.kind !== 'split') continue;
      const split = findSectionInRun(run, sl.sectionId)?.section;
      if (!split || split.kind !== 'split') continue;
      const rows = split.direction === 'rows';
      for (let i = 0; i + 1 < split.children.length; i++) {
        const ca = split.children[i]!;
        const cb = split.children[i + 1]!;
        const ra = layoutById.get(ca.section.id)?.rect;
        const rb = layoutById.get(cb.section.id)?.rect;
        if (!ra || !rb) continue;
        const splitId = split.id;
        handles.push({
          key: `split:${splitId}:${i}`,
          axis: rows ? 'y' : 'x',
          // Rows run top → bottom: the boundary sits between the bottom of `a` and the top of `b`.
          pos: rows ? (ra.y + rb.y + rb.height) / 2 : (ra.x + ra.width + rb.x) / 2,
          from: rows ? sl.rect.x : sl.rect.y,
          to: rows ? sl.rect.x + sl.rect.width : sl.rect.y + sl.rect.height,
          sign: rows ? -1 : 1,
          a: { spec: ca.size, size: rows ? ra.height : ra.width },
          b: { spec: cb.size, size: rows ? rb.height : rb.width },
          minSize,
          apply: (draft, a, b) => {
            const r = inRun(draft, runId);
            if (!r) return;
            setSplitChildSize(r, splitId, i, a);
            setSplitChildSize(r, splitId, i + 1, b);
          },
        });
      }
    }
  }
  return handles;
}
