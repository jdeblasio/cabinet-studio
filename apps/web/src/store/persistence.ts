/**
 * Browser storage: the project library in IndexedDB (see library.ts), autosave of the open
 * project, and switching between projects. Also JSON export/import.
 */
import { createDefaultProject, type Id, type Project } from '@built-in-planner/engine';
import { del, entries, get, set } from 'idb-keyval';
import { create } from 'zustand';
import {
  deleteProject,
  duplicateProject,
  listProjects,
  loadProject,
  openInitial,
  prepareImport,
  saveProject,
  setCurrent,
  type KV,
  type ProjectSummary,
} from './library';
import { useEditor } from './store';
import { validateProject } from './validate';

export { validateProject };

const kv: KV = {
  get: (key) => get(key),
  set: (key, value) => set(key, value),
  del: (key) => del(key),
  entries: () => entries(),
};

/** The saved projects, for the project picker. */
export const useLibrary = create<{ projects: ProjectSummary[] }>(() => ({ projects: [] }));

async function refreshLibrary(): Promise<void> {
  useLibrary.setState({ projects: await listProjects(kv) });
}

/** The project to open at startup (migrating a project saved by an older version). */
export async function loadInitialProject(): Promise<Project> {
  try {
    const project = await openInitial(kv);
    await refreshLibrary();
    return project;
  } catch (err) {
    console.warn('Could not open the saved projects', err);
    return createDefaultProject();
  }
}

// ---- Autosave ----

const SAVE_DELAY_MS = 500;
let timer: ReturnType<typeof setTimeout> | undefined;

async function saveOpenProject(): Promise<void> {
  timer = undefined;
  try {
    await saveProject(kv, useEditor.getState().project);
    await refreshLibrary();
  } catch (err) {
    console.warn('Autosave failed', err);
  }
}

/** Save now if an autosave is pending (before switching away from the open project). */
async function flushAutosave(): Promise<void> {
  if (timer === undefined) return;
  clearTimeout(timer);
  await saveOpenProject();
}

function cancelAutosave(): void {
  clearTimeout(timer);
  timer = undefined;
}

/** Debounced autosave of the open project. Returns an unsubscribe function. */
export function startAutosave(): () => void {
  const unsub = useEditor.subscribe((state, prev) => {
    if (!state.loaded || state.project === prev.project || state.dragBase) return;
    // Switching projects saves explicitly; this is for edits to the open one.
    if (!prev.loaded || state.project.id !== prev.project.id) return;
    clearTimeout(timer);
    timer = setTimeout(() => void saveOpenProject(), SAVE_DELAY_MS);
  });
  return () => {
    cancelAutosave();
    unsub();
  };
}

// ---- Switching projects ----

/** Show `project` in the editor (fresh undo history), saving it first when `save` is set. */
async function show(project: Project, save: boolean): Promise<void> {
  if (save) await saveProject(kv, project);
  else await setCurrent(kv, project.id);
  useEditor.getState().replaceProject(project);
  await refreshLibrary();
}

export async function openProject(id: Id): Promise<void> {
  if (id === useEditor.getState().project.id) return;
  await flushAutosave();
  const project = await loadProject(kv, id);
  if (!project) {
    window.alert('That project could not be opened.');
    await refreshLibrary();
    return;
  }
  await show(project, false);
}

export async function newProject(): Promise<void> {
  await flushAutosave();
  await show(createDefaultProject(), true);
}

export async function duplicateOpenProject(): Promise<void> {
  await flushAutosave();
  await show(duplicateProject(useEditor.getState().project), true);
}

/** Import a project file as a new project (a copy, if a project with its id is already saved). */
export async function importProjectFile(file: File): Promise<void> {
  const project = await readProjectFile(file);
  await flushAutosave();
  await show(await prepareImport(kv, project), true);
}

/** Delete the open project from this browser and open the most recent other one (or a new one). */
export async function deleteOpenProject(): Promise<void> {
  cancelAutosave();
  await deleteProject(kv, useEditor.getState().project.id);
  for (const s of await listProjects(kv)) {
    const project = await loadProject(kv, s.id);
    if (project) return show(project, false);
  }
  await show(createDefaultProject(), true);
}

// ---- Files ----

function fileSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'built-in';
}

export function exportProject(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileSlug(project.name)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readProjectFile(file: File): Promise<Project> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  return validateProject(data);
}
