/**
 * Islands: freestanding runs with no walls. An island's main run is its front face; its back is
 * either a second row of boxes (a back-face run, `islandOf` the main run) or a finished panel.
 *
 * Each face is derived like a run in its own space (x along the face as seen from that side,
 * y up, z out from the spine where the two rows meet), with:
 *  - both ends finished (open), no ceiling scribe, and the island's length and height;
 *  - the back face taking its tier heights, toe kick and countertop thickness from the front, so
 *    the two rows line up.
 * The island's countertop (over both rows, with a back overhang for seating) and its finished
 * back panel belong to the main run. For display (3D, top and end views, exports) the main run's
 * result also carries the back face's parts, mirrored into the main run's space: x runs the other
 * way and z goes negative, behind the spine.
 */
import type { Bounds, EdgeFace, HardwareItem, HardwareShape, Mitre, Part, RawEdge, RunResult } from '../derived';
import type { Project, Run } from '../model';
import { resolveSettings } from '../settings';
import type { Ticks } from '../units';
import { makePart, type Ctx } from './context';
import type { RunLayoutResult } from './layout';
import { endReach } from './reach';

/** The island a run belongs to (its main run), or undefined for a wall run. */
export function islandMain(project: Pick<Project, 'runs'>, run: Run): Run | undefined {
  if (run.kind !== 'island') return undefined;
  return run.islandOf ? project.runs.find((r) => r.id === run.islandOf) : run;
}

/**
 * The run as derived: for an island face, finished ends, no ceiling scribe, and (for the back
 * face) the island's size and the front's tier heights, toe kick and countertop thickness.
 */
export function effectiveRun(project: Project, run: Run): Run {
  if (run.kind !== 'island') return run;
  const main = islandMain(project, run) ?? run;
  const seg = main.wall[0]!;
  const tiers =
    run === main
      ? run.tiers
      : run.tiers.map((t, i) => {
          const m = main.tiers[i];
          if (!m) return t;
          const copy = { ...t, height: m.height };
          if (m.toeKick) copy.toeKick = { ...m.toeKick };
          else delete copy.toeKick;
          if (m.countertop) copy.countertop = { ...m.countertop };
          else delete copy.countertop;
          return copy;
        });
  return {
    ...run,
    wall: [{ id: seg.id, length: seg.length, ceilingHeight: seg.ceilingHeight }],
    ends: { left: 'open', right: 'open' },
    tiers,
    overrides: { ...run.overrides, ceilingScribe: 0 },
  };
}

/**
 * How far the island reaches behind the spine (where the countertop's back overhang starts):
 * the back face's boxes and frame, or the finished back panel.
 */
export function islandBackExtent(project: Project, main: Run): Ticks {
  const back = project.runs.find((r) => r.islandOf === main.id);
  if (main.island?.back !== 'panel' && back) {
    const s = resolveSettings(project, [back, back.tiers[0]]);
    const tf = s.construction === 'frameless' ? 0 : materialThickness(project, s.materials.faceFrame);
    return (back.tiers[0]?.depth ?? 0) + tf;
  }
  const s = resolveSettings(project, [main]);
  return materialThickness(project, s.materials.carcass);
}

function materialThickness(project: Project, id: string): Ticks {
  return project.materials.find((m) => m.id === id)?.thickness ?? 0;
}

/** The finished panel over the backs of a single-sided island's boxes, floor to countertop. */
export function islandBackPanel(ctx: Ctx, layout: RunLayoutResult): Part[] {
  const run = ctx.run;
  if (run.kind !== 'island' || run.islandOf || run.island?.back !== 'panel') return [];
  const bottom = layout.tiers[0];
  if (!bottom) return [];
  const boxes = layout.boxes.filter((b) => b.tierId === bottom.tierId).sort((a, b) => a.carcass.x - b.carcass.x);
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  if (!first || !last) return [];
  const s = resolveSettings(ctx.project, [run]);
  const t = ctx.thickness(s.materials.carcass, run.id);
  // Between the end panels, which run back over its ends (see frame.ts), when there are any.
  const panelL = first.settings.faceFrame.endStiles.left === 'full' && first.settings.construction !== 'frameless';
  const panelR = last.settings.faceFrame.endStiles.right === 'full' && last.settings.construction !== 'frameless';
  const x0 = first.carcass.x - endReach(ctx, first, 'left') + (panelL ? t : 0);
  const x1 = last.carcass.x + last.carcass.width + endReach(ctx, last, 'right') - (panelR ? t : 0);
  const top = bottom.y + bottom.height - bottom.countertop;
  return [
    makePart({
      id: `${run.id}/finished-back`,
      name: 'Finished back',
      role: 'side',
      materialId: s.materials.carcass,
      bounds: { x: x0, y: 0, z: -t, width: x1 - x0, height: top, depth: t },
      grain: 'horizontal',
      thicknessAxis: 'z',
      ownerId: run.id,
      note: 'Covers the backs of the boxes, floor to countertop; scribe it to the floor',
    }),
  ];
}

const FLIP: Record<EdgeFace, EdgeFace> = { left: 'right', right: 'left', back: 'front', front: 'back', top: 'top', bottom: 'bottom' };

/** Mirror bounds from a back face's space into the main run's (x reversed, z behind the spine). */
function mirrorBounds(b: Bounds, length: Ticks): Bounds {
  return { ...b, x: length - (b.x + b.width), z: -(b.z + b.depth) };
}

function mirrorPart(p: Part, length: Ticks): Part {
  const out: Part = { ...p, bounds: mirrorBounds(p.bounds, length) };
  if (p.bandedEdges) out.bandedEdges = p.bandedEdges.map((f) => FLIP[f]);
  if (p.mitres) out.mitres = p.mitres.map((m): Mitre => ({ face: FLIP[m.face], outer: FLIP[m.outer] }));
  if (p.rawEdges)
    out.rawEdges = p.rawEdges.map(
      (e): RawEdge => ({
        face: FLIP[e.face],
        axis: e.axis,
        from: e.axis === 'x' ? length - e.to : e.axis === 'z' ? -e.to : e.from,
        to: e.axis === 'x' ? length - e.from : e.axis === 'z' ? -e.from : e.to,
      }),
    );
  if (p.features) out.features = p.features.map((f) => ({ ...f, x: length - f.x, z: -f.z }));
  return out;
}

function mirrorShape(s: HardwareShape, length: Ticks): HardwareShape {
  return s.kind === 'box' ? { ...s, bounds: mirrorBounds(s.bounds, length) } : { ...s, x: length - s.x, z: -s.z };
}

/** A back face's result, mirrored into its island's main run space, for display. */
export function mirrorBackFace(back: RunResult, length: Ticks): NonNullable<RunResult['island']> {
  return {
    backRunId: back.runId,
    parts: back.parts.map((p) => mirrorPart(p, length)),
    hardware: back.hardware.map((h): HardwareItem => ({ ...h, shapes: h.shapes.map((s) => mirrorShape(s, length)) })),
    boxes: back.boxes.map((b) => ({ ...b, carcass: mirrorBounds(b.carcass, length) })),
  };
}
