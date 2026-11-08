import { deriveRun, type Id, type Project, type RunResult } from '@built-in-planner/engine';
import { useEditor } from './store';

const cache = new WeakMap<Project, Map<Id, RunResult>>();

function emptyResult(project: Project, runId: Id, message: string): RunResult {
  const run = project.runs.find((r) => r.id === runId);
  return {
    runId,
    width: run?.wall[0]?.length ?? 0,
    ceilingHeight: run?.wall[0]?.ceilingHeight ?? 0,
    ceilingGap: 0,
    tiers: [],
    boxes: [],
    gaps: [],
    frames: [],
    parts: [],
    issues: [{ severity: 'error', code: 'derive-failed', message, sourceId: runId }],
  };
}

/** Derived result for a run, memoized per project snapshot. Never throws. */
export function getRunResult(project: Project, runId: Id): RunResult {
  let byRun = cache.get(project);
  if (!byRun) {
    byRun = new Map();
    cache.set(project, byRun);
  }
  let result = byRun.get(runId);
  if (!result) {
    try {
      result = deriveRun(project, runId);
    } catch (err) {
      console.error('deriveRun failed', err);
      result = emptyResult(project, runId, `Could not compute this design: ${err instanceof Error ? err.message : String(err)}`);
    }
    byRun.set(runId, result);
  }
  return result;
}

export function useRunResult(): RunResult {
  const project = useEditor((s) => s.project);
  const runId = useEditor((s) => s.activeRunId);
  return getRunResult(project, runId);
}
