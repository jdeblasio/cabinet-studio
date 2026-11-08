import { createDefaultProject } from '@built-in-planner/engine';
import { useRef } from 'react';
import { otherSystem } from '../lib/units';
import { exportProject, readProjectFile } from '../store/persistence';
import { useEditor } from '../store/store';
import { TextInput } from './inspector/fields';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

export function Toolbar() {
  const project = useEditor((s) => s.project);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { edit, undo, redo, replaceProject, showOtherUnits, setShowOtherUnits } = useEditor();
  const fileRef = useRef<HTMLInputElement>(null);
  const other = otherSystem(project.units.system);

  return (
    <header className="toolbar">
      <span className="brand">Built-in Planner</span>
      <span className="project-name">
        <TextInput value={project.name} ariaLabel="Project name" onCommit={(name) => edit((d) => void (d.name = name || d.name))} />
      </span>
      <span className="toolbar-group">
        <button
          title="Start a new project (undoable)"
          onClick={() => replaceProject(createDefaultProject(), { undoable: true })}
        >
          New
        </button>
        <button onClick={() => fileRef.current?.click()}>Import…</button>
        <button onClick={() => exportProject(project)}>Export</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              replaceProject(await readProjectFile(file), { undoable: true });
            } catch (err) {
              window.alert(`Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }}
        />
      </span>
      <span className="toolbar-group">
        <button onClick={undo} disabled={!canUndo} title={`Undo (${mod}Z)`}>
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title={`Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z'})`}>
          Redo
        </button>
      </span>
      <span className="spacer" />
      <label className="toggle" title={`Show lengths in ${other} (approximate). The project's own unit system is set in the inspector.`}>
        <input type="checkbox" checked={showOtherUnits} onChange={(e) => setShowOtherUnits(e.target.checked)} />
        Show in {other === 'metric' ? 'mm' : 'inches'} (≈)
      </label>
    </header>
  );
}
