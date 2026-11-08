import { createDefaultProject, type Id, type Project } from '@built-in-planner/engine';
import { produce, type Draft } from 'immer';
import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { validSelection, type Selection } from './selection';

const HISTORY_LIMIT = 200;

export type View3D = 'shaded' | 'wireframe' | 'exploded';
/** Top-level views: the design editor, and outputs derived from the design. */
export type AppView = 'design' | 'project' | 'cutlist' | 'sheets' | 'shopping' | 'drawings';

export interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  /** Project as it was when the current drag started; null when not dragging. */
  dragBase: Project | null;
  selection: Selection | null;
  activeRunId: Id;
  /** Show lengths in the other unit system (approximate). */
  showOtherUnits: boolean;
  view3d: View3D;
  /** Draw hardware (slides, hinges, shelf pins) in the 3D preview. */
  showHardware: boolean;
  /** Inspector Construction sections list every setting, not just this level's overrides. */
  showAllSettings: boolean;
  view: AppView;
  loaded: boolean;

  /** Apply an edit as one undo step. */
  edit: (recipe: (draft: Draft<Project>) => void) => void;
  /** Start a continuous edit (drag). Subsequent dragTo calls replace each other; endDrag records one undo step. */
  beginDrag: () => void;
  /** Re-apply `recipe` to the project as it was at drag start. */
  dragTo: (recipe: (draft: Draft<Project>) => void) => void;
  /** Like dragTo, with a project already derived from the drag-start project. */
  dragToProject: (project: Project) => void;
  endDrag: () => void;
  cancelDrag: () => void;
  undo: () => void;
  redo: () => void;
  select: (selection: Selection | null) => void;
  /** Show a different wall run in the editor. */
  setActiveRun: (runId: Id) => void;
  /** Open a different project (load, switch, new, import). Starts a fresh undo history. */
  replaceProject: (project: Project) => void;
  setShowOtherUnits: (v: boolean) => void;
  setView3d: (v: View3D) => void;
  setShowHardware: (v: boolean) => void;
  setShowAllSettings: (v: boolean) => void;
  setView: (v: AppView) => void;
}

function fixSelection(project: Project, selection: Selection | null, activeRunId: Id): Selection | null {
  if (!selection) return null;
  if (validSelection(project, selection)) return selection;
  return project.runs.some((r) => r.id === activeRunId) ? { kind: 'run', runId: activeRunId } : null;
}

function firstRunId(project: Project): Id {
  return project.runs[0]?.id ?? '';
}

/** Keep the active run if it still exists in `project`, else fall back to its first run. */
function keepRunId(project: Project, runId: Id): Id {
  return project.runs.some((r) => r.id === runId) ? runId : firstRunId(project);
}

const editorState: StateCreator<EditorState> = (set, get) => {
  const initial = createDefaultProject();
  return {
    project: initial,
    past: [],
    future: [],
    dragBase: null,
    selection: null,
    activeRunId: firstRunId(initial),
    showOtherUnits: false,
    view3d: 'shaded',
    showHardware: true,
    showAllSettings: false,
    view: 'design',
    loaded: false,

    edit: (recipe) => {
      const { project, past, dragBase } = get();
      if (dragBase) return; // ignore discrete edits mid-drag
      const next = produce(project, recipe);
      if (next === project) return;
      set({
        project: next,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: [],
        selection: fixSelection(next, get().selection, get().activeRunId),
      });
    },

    beginDrag: () => {
      if (get().dragBase) return;
      set({ dragBase: get().project });
    },

    dragTo: (recipe) => {
      const base = get().dragBase;
      if (!base) return;
      set({ project: produce(base, recipe) });
    },

    dragToProject: (project) => {
      if (!get().dragBase) return;
      set({ project });
    },

    endDrag: () => {
      const { dragBase, project, past } = get();
      if (!dragBase) return;
      if (project === dragBase) {
        set({ dragBase: null });
        return;
      }
      set({ dragBase: null, past: [...past, dragBase].slice(-HISTORY_LIMIT), future: [] });
    },

    cancelDrag: () => {
      const { dragBase } = get();
      if (!dragBase) return;
      set({ project: dragBase, dragBase: null });
    },

    undo: () => {
      const { past, project, future, dragBase } = get();
      if (dragBase || past.length === 0) return;
      const prev = past[past.length - 1]!;
      const activeRunId = keepRunId(prev, get().activeRunId);
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [project, ...future],
        activeRunId,
        selection: fixSelection(prev, get().selection, activeRunId),
      });
    },

    redo: () => {
      const { past, project, future, dragBase } = get();
      if (dragBase || future.length === 0) return;
      const next = future[0]!;
      set({
        project: next,
        past: [...past, project],
        future: future.slice(1),
        activeRunId: keepRunId(next, get().activeRunId),
        selection: fixSelection(next, get().selection, keepRunId(next, get().activeRunId)),
      });
    },

    select: (selection) => set({ selection }),
    setActiveRun: (runId) => {
      if (!get().project.runs.some((r) => r.id === runId)) return;
      set({ activeRunId: runId, selection: { kind: 'run', runId } });
    },

    replaceProject: (project) =>
      set({
        project,
        past: [],
        future: [],
        dragBase: null,
        selection: null,
        activeRunId: firstRunId(project),
        loaded: true,
      }),

    setShowOtherUnits: (showOtherUnits) => set({ showOtherUnits }),
    setView3d: (view3d) => set({ view3d }),
    setShowHardware: (showHardware) => set({ showHardware }),
    setShowAllSettings: (showAllSettings) => set({ showAllSettings }),
    setView: (view) => set({ view }),
  };
};

/**
 * The editor store. In development the same instance survives hot module reloads, so editing a
 * module the store depends on doesn't reset it to an empty, unloaded project.
 */
const kept = import.meta.hot?.data.useEditor as StoreApi<EditorState> | undefined;
export const useEditor: UseBoundStore<StoreApi<EditorState>> = (kept as UseBoundStore<StoreApi<EditorState>> | undefined) ?? create<EditorState>()(editorState);
if (kept) {
  // Keep the data, but take this version's actions (bound to the kept store) and any new fields.
  const fresh = editorState(kept.setState, kept.getState, kept);
  const current = kept.getState() as unknown as Record<string, unknown>;
  kept.setState(Object.fromEntries(Object.entries(fresh).filter(([k, v]) => typeof v === 'function' || !(k in current))) as Partial<EditorState>);
}
if (import.meta.hot) import.meta.hot.data.useEditor = useEditor;

/** The active run (throws if the project somehow has none). */
export function useActiveRun() {
  return useEditor((s) => s.project.runs.find((r) => r.id === s.activeRunId) ?? s.project.runs[0]!);
}

if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__editor = useEditor;
