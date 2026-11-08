import { DEFAULT_MATERIALS, DEFAULT_SETTINGS, mergeSettings, SCHEMA_VERSION, type Project } from '@built-in-planner/engine';
import { get, set } from 'idb-keyval';
import { useEditor } from './store';

const KEY = 'built-in-planner:current-project';
const SAVE_DELAY_MS = 500;

/** Check an unknown value is a usable project file and normalize it. Throws with a readable message. */
export function validateProject(data: unknown): Project {
  if (typeof data !== 'object' || data === null) throw new Error('Not a project file.');
  const p = data as Partial<Project>;
  if (p.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      p.schemaVersion === undefined
        ? 'Not a Built-in Planner project (no schemaVersion).'
        : `Unsupported project version ${String(p.schemaVersion)} (this app reads version ${SCHEMA_VERSION}).`,
    );
  }
  if (!Array.isArray(p.runs) || p.runs.length === 0) throw new Error('Project has no wall runs.');
  if (!p.units || (p.units.system !== 'imperial' && p.units.system !== 'metric')) throw new Error('Project units are missing or invalid.');
  if (!Array.isArray(p.materials)) throw new Error('Project materials are missing.');
  for (const run of p.runs) {
    if (!Array.isArray(run.tiers) || !Array.isArray(run.wall) || run.wall.length === 0) throw new Error(`Run "${run.name ?? run.id}" is malformed.`);
    if (!Array.isArray(run.spans)) run.spans = [];
  }
  // Fill in settings added since the file was written, and any default materials they refer to.
  const settings = mergeSettings(DEFAULT_SETTINGS, p.settings);
  const used = new Set(Object.values(settings.materials));
  const materials = [...p.materials, ...DEFAULT_MATERIALS.filter((m) => used.has(m.id) && !p.materials!.some((pm) => pm.id === m.id))];
  return {
    ...(p as Project),
    name: typeof p.name === 'string' ? p.name : 'Untitled built-in',
    styles: Array.isArray(p.styles) ? p.styles : [],
    settings,
    materials,
  };
}

export async function loadSavedProject(): Promise<Project | null> {
  try {
    const data = await get(KEY);
    return data ? validateProject(data) : null;
  } catch (err) {
    console.warn('Could not load saved project', err);
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Debounced autosave of the current project to IndexedDB. Returns an unsubscribe function. */
export function startAutosave(): () => void {
  const unsub = useEditor.subscribe((state, prev) => {
    if (!state.loaded || state.project === prev.project || state.dragBase) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void set(KEY, useEditor.getState().project).catch((err) => console.warn('Autosave failed', err));
    }, SAVE_DELAY_MS);
  });
  return () => {
    clearTimeout(timer);
    unsub();
  };
}

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
