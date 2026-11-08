import { findBox, findSpan, removeBox, removeSpan } from '@built-in-planner/engine';
import { useEffect } from 'react';
import { Elevation } from './components/elevation/Elevation';
import { Inspector } from './components/inspector/Inspector';
import { Preview3D } from './components/preview/Preview3D';
import { Problems } from './components/Problems';
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

export function App() {
  const loaded = useEditor((s) => s.loaded);

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
      <main className="main">
        <div className="center">
          <section className="pane elevation-pane" aria-label="Front elevation">
            <Elevation />
          </section>
          <Problems />
          <section className="pane preview-pane" aria-label="3D preview">
            <Preview3D />
          </section>
        </div>
        <Inspector />
      </main>
    </div>
  );
}
