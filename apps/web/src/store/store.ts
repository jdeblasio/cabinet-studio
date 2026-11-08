import { createDefaultProject, type Id, type Project } from '@built-in-planner/engine';
import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import { validSelection, type Selection } from './selection';

const HISTORY_LIMIT = 200;

export type View3D = 'shaded' | 'wireframe';

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
  /** Open a different project (load, switch, new, import). Starts a fresh undo history. */
  replaceProject: (project: Project) => void;
  setShowOtherUnits: (v: boolean) => void;
  setView3d: (v: View3D) => void;
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

export const useEditor = create<EditorState>()((set, get) => {
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
  };
});

/** The active run (throws if the project somehow has none). */
export function useActiveRun() {
  return useEditor((s) => s.project.runs.find((r) => r.id === s.activeRunId) ?? s.project.runs[0]!);
}

if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__editor = useEditor;
