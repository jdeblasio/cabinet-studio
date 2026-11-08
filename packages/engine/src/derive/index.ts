import type { BoxLayout, Issue, Part, RunResult } from '../derived';
import { formatLength } from '../format';
import type { Id, Project } from '../model';
import { deriveBox } from './box';
import { makeCtx } from './context';
import { deriveFrames } from './frame';
import { layoutRun } from './layout';
import { deriveToeKick } from './toeKick';

function emptyResult(runId: Id, issues: Issue[]): RunResult {
  return { runId, width: 0, ceilingHeight: 0, ceilingGap: 0, tiers: [], boxes: [], gaps: [], frames: [], parts: [], issues };
}

/** Derive layout, parts and issues for one run. Pure and deterministic. */
export function deriveRun(project: Project, runId: Id): RunResult {
  const run = project.runs.find((r) => r.id === runId);
  if (!run) return emptyResult(runId, [{ severity: 'error', code: 'run-missing', message: 'Run not found.', sourceId: runId }]);
  const issues: Issue[] = [];
  if (run.wall.length === 0) {
    issues.push({ severity: 'error', code: 'wall-missing', message: 'This run has no wall.', sourceId: run.id });
    return emptyResult(runId, issues);
  }
  if (run.wall.length > 1) {
    issues.push({ severity: 'info', code: 'corners-unsupported', message: 'Corners are not supported yet; only the first wall segment is used.', sourceId: run.id });
  }

  const ctx = makeCtx(project, run, issues);
  const layout = layoutRun(ctx);

  const parts: Part[] = [];
  const boxes: BoxLayout[] = [];
  let frameless = false;
  for (const placed of layout.boxes) {
    if (placed.settings.construction === 'frameless') frameless = true;
    const { parts: boxParts, sections } = deriveBox(ctx, placed);
    parts.push(...boxParts);
    boxes.push({ id: placed.id, source: placed.source, tierId: placed.tierId, carcass: placed.carcass, sections });
  }
  const { frames, parts: stiles } = deriveFrames(ctx, layout.boxes, layout.width, layout.gaps);
  parts.push(...stiles, ...deriveToeKick(ctx, layout));

  if (frameless) {
    issues.push({ severity: 'warning', code: 'frameless-unsupported', message: 'Frameless construction arrives in a later milestone; face-frame construction is shown.', sourceId: run.id });
  }
  for (const id of ctx.offGridMaterials) {
    const m = project.materials.find((mat) => mat.id === id);
    if (!m) continue;
    issues.push({
      severity: 'info',
      code: 'material-off-grid',
      message: `${m.name} (${formatLength(m.thickness, project.units.system, { markApproximate: true })}) is off the project grid; interior parts are rounded down toward a slightly loose fit.`,
      sourceId: run.id,
    });
  }

  return {
    runId,
    width: layout.width,
    ceilingHeight: layout.ceilingHeight,
    ceilingGap: layout.ceilingGap,
    tiers: layout.tiers,
    boxes,
    gaps: layout.gaps,
    frames,
    parts,
    issues,
  };
}

/** Derive every run in the project. */
export function deriveProject(project: Project): RunResult[] {
  return project.runs.map((r) => deriveRun(project, r.id));
}
