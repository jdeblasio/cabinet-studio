import { useEffect, useRef, useState } from 'react';
import { otherSystem } from '../lib/units';
import {
  deleteOpenProject,
  duplicateOpenProject,
  exportProject,
  importProjectFile,
  newProject,
  openProject,
  useLibrary,
} from '../store/persistence';
import { useEditor } from '../store/store';
import { TextInput } from './inspector/fields';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

function ProjectPicker() {
  const project = useEditor((s) => s.project);
  const saved = useLibrary((s) => s.projects);
  // The open project shows its live name (the library catches up on the next autosave).
  const list = saved.some((p) => p.id === project.id) ? saved : [{ id: project.id, name: project.name, savedAt: Date.now() }, ...saved];
  const label = (p: (typeof list)[number]) => {
    const name = p.id === project.id ? project.name : p.name;
    const twin = list.some((q) => q.id !== p.id && (q.id === project.id ? project.name : q.name) === name);
    return twin ? `${name} · ${new Date(p.savedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}` : name;
  };
  return (
    <select className="input project-picker" value={project.id} aria-label="Open project" title="Projects saved in this browser" onChange={(e) => void openProject(e.target.value)}>
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {label(p)}
        </option>
      ))}
    </select>
  );
}

/** Delete with an inline second click to confirm (no browser dialog). */
function DeleteButton() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={armed ? 'danger' : ''}
      title="Delete this project from this browser (export it first to keep a copy)"
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        void deleteOpenProject();
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? 'Really delete?' : 'Delete'}
    </button>
  );
}

export function Toolbar() {
  const project = useEditor((s) => s.project);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { edit, undo, redo, showOtherUnits, setShowOtherUnits } = useEditor();
  const fileRef = useRef<HTMLInputElement>(null);
  const other = otherSystem(project.units.system);

  return (
    <header className="toolbar">
      <span className="brand">Built-in Planner</span>
      <span className="toolbar-group">
        <ProjectPicker />
        <span className="project-name">
          <TextInput value={project.name} ariaLabel="Project name" onCommit={(name) => edit((d) => void (d.name = name || d.name))} />
        </span>
      </span>
      <span className="toolbar-group">
        <button title="Start a new project (the current one stays saved)" onClick={() => void newProject()}>
          New
        </button>
        <button title="Save a copy of this project and open it" onClick={() => void duplicateOpenProject()}>
          Duplicate
        </button>
        <DeleteButton />
      </span>
      <span className="toolbar-group">
        <button title="Open a project file as a new project" onClick={() => fileRef.current?.click()}>
          Import…
        </button>
        <button title="Download this project as a file" onClick={() => exportProject(project)}>
          Export
        </button>
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
              await importProjectFile(file);
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
      <label className="toggle" title={`Show lengths in ${other} (approximate). The project's own unit system is set on the Project tab.`}>
        <input type="checkbox" checked={showOtherUnits} onChange={(e) => setShowOtherUnits(e.target.checked)} />
        Show {other === 'metric' ? 'mm' : 'inches'} (≈)
      </label>
    </header>
  );
}
