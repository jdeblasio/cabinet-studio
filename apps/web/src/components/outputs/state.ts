/**
 * Cut list options (saved in the project as overrides of the defaults) and the memoized cut
 * report for the current project.
 */
import {
  buildCutReport,
  DEFAULT_CUTLIST_OPTIONS,
  mergeSettings,
  resolveCutListOptions,
  type CutListOptions,
  type CutReport,
  type DeepPartial,
  type PartOwner,
  type Project,
} from '@cabinet-studio/engine';
import { create } from 'zustand';
import { getProjectResults, getRunResult } from '../../store/derived';
import { selectionForId } from '../../store/selection';
import { useEditor } from '../../store/store';

/** View-only state (not saved with the project). */
interface CutViewState {
  /** Show cut sequence numbers on sheet layouts. */
  showCutOrder: boolean;
  setShowCutOrder: (v: boolean) => void;
}

export const useCutOptions = create<CutViewState>()((set) => ({
  showCutOrder: false,
  setShowCutOrder: (showCutOrder) => set({ showCutOrder }),
}));

const resolved = new WeakMap<object, CutListOptions>();

/** The project's cut list options: its saved overrides on top of the defaults (memoized). */
export function cutOptionsOf(project: Project): CutListOptions {
  const saved = project.cutList;
  if (!saved) return DEFAULT_CUTLIST_OPTIONS;
  let options = resolved.get(saved);
  if (!options) {
    options = resolveCutListOptions(saved);
    resolved.set(saved, options);
  }
  return options;
}

export function useProjectCutOptions(): CutListOptions {
  return useEditor((s) => cutOptionsOf(s.project));
}

/** Change cut list options (saved with the project, undoable). */
export function setCutOptions(patch: DeepPartial<CutListOptions>): void {
  useEditor.getState().edit((d) => {
    d.cutList = mergeSettings((d.cutList ?? {}) as DeepPartial<CutListOptions>, patch);
  });
}

export function resetCutOptions(): void {
  useEditor.getState().edit((d) => {
    delete d.cutList;
  });
}

const cache = new WeakMap<Project, { options: CutListOptions; report: CutReport }>();

/** Cut report for a project snapshot and options, memoized (one entry per project snapshot). */
export function getCutReport(project: Project, options: CutListOptions): CutReport {
  const hit = cache.get(project);
  if (hit && hit.options === options) return hit.report;
  const report = buildCutReport(project, getProjectResults(project), options);
  cache.set(project, { options, report });
  return report;
}

export function useCutReport(): { project: Project; report: CutReport; options: CutListOptions } {
  const project = useEditor((s) => s.project);
  const options = cutOptionsOf(project);
  return { project, options, report: getCutReport(project, options) };
}

/** Select a part owner (box, span or tier) in the design and switch to the design view. */
export function locateOwner(owner: Pick<PartOwner, 'runId' | 'ownerId'>): void {
  const st = useEditor.getState();
  const run = st.project.runs.find((r) => r.id === owner.runId);
  if (!run) return;
  if (st.activeRunId !== run.id) st.setActiveRun(run.id);
  st.select(selectionForId(run, owner.ownerId, getRunResult(st.project, run.id)));
  st.setView('design');
}
