import type { BoxLayout, HardwareItem, Issue, Part, RunResult, SectionLayout } from '../derived';
import { formatLength } from '../format';
import type { Id, Project } from '../model';
import { deriveBox } from './box';
import { chooseCorners } from './corners';
import { applyFinishes } from './finish';
import { splitOversizeParts } from './split';
import { markRawEdges } from './edges';
import { resolveSettings } from '../settings';
import { deriveCountertops } from './countertop';
import { makeCtx } from './context';
import { deriveFrames } from './frame';
import { deriveScribeStrips } from './scribe';
import { deriveTrim } from './trim';
import { layoutRun } from './layout';
import { deriveToeKick } from './toeKick';

function emptyResult(runId: Id, issues: Issue[]): RunResult {
  return { runId, width: 0, ceilingHeight: 0, ceilingGap: 0, tiers: [], boxes: [], gaps: [], frames: [], parts: [], hardware: [], issues };
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
  const hardware: HardwareItem[] = [];
  const sectionsOf = new Map<string, SectionLayout[]>();
  const boxPartIds = new Map<string, Set<string>>();
  for (const placed of layout.boxes) {
    const { parts: boxParts, sections, hardware: boxHardware } = deriveBox(ctx, placed);
    parts.push(...boxParts);
    hardware.push(...boxHardware);
    sectionsOf.set(placed.id, sections);
    boxPartIds.set(placed.id, new Set(boxParts.map((p) => p.id)));
  }
  const { frames, parts: stiles } = deriveFrames(ctx, layout.boxes, layout.width, layout.gaps, layout.lengthVariance);
  parts.push(...stiles, ...deriveToeKick(ctx, layout), ...deriveCountertops(ctx, layout, stiles), ...deriveScribeStrips(ctx, layout), ...deriveTrim(ctx, layout));
  chooseCorners(ctx, layout, parts, hardware, sectionsOf, boxPartIds);
  const boxes: BoxLayout[] = layout.boxes.map((placed) => ({ id: placed.id, source: placed.source, tierId: placed.tierId, carcass: placed.carcass, sections: sectionsOf.get(placed.id) ?? [] }));

  // Settings for a part's owner: its box's; a tier's for toe kicks and countertops; else the run's.
  const boxSettings = new Map(layout.boxes.map((b) => [b.id, b.settings]));
  const runSettings = resolveSettings(project, [run]);
  const tierSettings = new Map(run.tiers.map((t) => [t.id, resolveSettings(project, [run, t])]));
  const settingsFor = (ownerId: string) => boxSettings.get(ownerId) ?? tierSettings.get(ownerId) ?? runSettings;
  applyFinishes(parts, settingsFor);
  splitOversizeParts(ctx, parts, hardware, settingsFor);
  markRawEdges(ctx, layout, parts, settingsFor);

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

  // A box re-derived for its corner joints reports the same issues again: keep one of each.
  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const key = `${i.severity}|${i.code}|${i.sourceId}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  issues.length = 0;
  issues.push(...unique);

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
    hardware,
    issues,
  };
}

/** Derive every run in the project. */
export function deriveProject(project: Project): RunResult[] {
  return project.runs.map((r) => deriveRun(project, r.id));
}
