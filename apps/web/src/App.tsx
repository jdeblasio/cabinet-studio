import { findBox, findSpan, removeBox, removeSpan } from '@cabinet-studio/engine';
import { useEffect, useRef } from 'react';
import { BuildView } from './components/build/BuildView';
import { DrawingsView } from './components/drawings/DrawingsView';
import { Elevation } from './components/elevation/Elevation';
import { Inspector } from './components/inspector/Inspector';
import { CutListView } from './components/outputs/CutListView';
import { SheetsView } from './components/outputs/SheetsView';
import { ShoppingView } from './components/outputs/ShoppingView';
import { ViewTabs } from './components/ViewTabs';
import { Preview3D } from './components/preview/Preview3D';
import { Problems } from './components/Problems';
import { ProjectView } from './components/project/ProjectView';
import { Splitter, useSplit } from './components/Splitter';
import { Toolbar } from './components/Toolbar';
import { loadInitialProject, startAutosave } from './store/persistence';
import { parentSelection } from './store/selection';
import { useEditor } from './store/store';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const state = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        state.redo();
      } else if (e.key === 'Escape') {
        if (state.dragBase) return; // handled by the drag
        const run = state.project.runs.find((r) => r.id === state.activeRunId);
        if (run && state.selection) state.select(parentSelection(run, state.selection));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = state.selection;
        if (!sel) return;
        if (sel.kind === 'box' || sel.kind === 'span') {
          e.preventDefault();
          const run = state.project.runs.find((r) => r.id === sel.runId);
          if (!run) return;
          const parent = parentSelection(run, sel);
          state.edit((d) => {
            const r = d.runs.find((x) => x.id === sel.runId);
            if (!r) return;
            if (sel.kind === 'box' && findBox(r, sel.boxId)) removeBox(r, sel.boxId);
            if (sel.kind === 'span' && findSpan(r, sel.spanId)) removeSpan(r, sel.spanId);
          });
          state.select(parent);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function OutputView() {
  const view = useEditor((s) => s.view);
  switch (view) {
    case 'project':
      return <ProjectView />;
    case 'cutlist':
      return <CutListView />;
    case 'sheets':
      return <SheetsView />;
    case 'shopping':
      return <ShoppingView />;
    case 'drawings':
      return <DrawingsView />;
    case 'build':
      return <BuildView />;
    default:
      return null;
  }
}

/** The elevation over the 3D preview, with a draggable divider between them. */
function DesignCenter() {
  const [split, setSplit] = useSplit();
  const elevation = useRef<HTMLElement>(null);
  const preview = useRef<HTMLElement>(null);
  return (
    <div className="center" style={{ gridTemplateRows: `minmax(0, ${split}fr) auto auto minmax(0, ${1 - split}fr)` }}>
      <section ref={elevation} className="pane elevation-pane" aria-label="Front elevation">
        <Elevation />
      </section>
      <Problems />
      <Splitter upper={elevation} lower={preview} split={split} onChange={setSplit} label="Resize the elevation and 3D preview" />
      <section ref={preview} className="pane preview-pane" aria-label="3D preview">
        <Preview3D />
      </section>
    </div>
  );
}

export function App() {
  const loaded = useEditor((s) => s.loaded);
  const view = useEditor((s) => s.view);

  useEffect(() => {
    let cancelled = false;
    void loadInitialProject().then((project) => {
      if (!cancelled && !useEditor.getState().loaded) useEditor.getState().replaceProject(project);
    });
    const stop = startAutosave();
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useKeyboard();

  if (!loaded) return <div className="loading">Loading…</div>;
  return (
    <div className="app">
      <Toolbar />
      <ViewTabs />
      {view === 'design' ? (
        <main className="main">
          <DesignCenter />
          <Inspector />
        </main>
      ) : (
        <main className="output-main">
          <OutputView />
        </main>
      )}
    </div>
  );
}
