/**
 * The project library: every project saved in this browser, one record per project, plus the
 * id of the one that was open last. Written against a small async key-value interface so it can
 * be tested without IndexedDB (persistence.ts wires it to idb-keyval).
 */
import { createDefaultProject, newId, type Id, type Project } from '@built-in-planner/engine';
import { validateProject } from './validate';

export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  entries(): Promise<[unknown, unknown][]>;
}

export interface ProjectSummary {
  id: Id;
  name: string;
  /** ms since epoch. */
  savedAt: number;
}

interface SavedRecord {
  project: Project;
  savedAt: number;
}

/** Where versions before the library kept their single project. */
export const LEGACY_KEY = 'built-in-planner:current-project';
const PREFIX = 'built-in-planner:project:';
const CURRENT_KEY = 'built-in-planner:current-id';
const keyOf = (id: Id) => PREFIX + id;

/** Saved projects, most recently saved first. */
export async function listProjects(kv: KV): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  for (const [key, value] of await kv.entries()) {
    if (typeof key !== 'string' || !key.startsWith(PREFIX)) continue;
    const rec = value as Partial<SavedRecord> | undefined;
    const name = rec?.project && typeof rec.project.name === 'string' ? rec.project.name : 'Untitled';
    out.push({ id: key.slice(PREFIX.length), name, savedAt: rec?.savedAt ?? 0 });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
}

/** Save a project under its id and remember it as the open one. */
export async function saveProject(kv: KV, project: Project, now = Date.now()): Promise<void> {
  await kv.set(keyOf(project.id), { project, savedAt: now } satisfies SavedRecord);
  await kv.set(CURRENT_KEY, project.id);
}

export async function setCurrent(kv: KV, id: Id): Promise<void> {
  await kv.set(CURRENT_KEY, id);
}

/** Load and validate a saved project; null if it's missing or unreadable. */
export async function loadProject(kv: KV, id: Id): Promise<Project | null> {
  const rec = (await kv.get(keyOf(id))) as Partial<SavedRecord> | undefined;
  if (!rec?.project) return null;
  try {
    return validateProject(rec.project);
  } catch (err) {
    console.warn(`Saved project ${id} is unreadable`, err);
    return null;
  }
}

export async function deleteProject(kv: KV, id: Id): Promise<void> {
  await kv.del(keyOf(id));
  if ((await kv.get(CURRENT_KEY)) === id) await kv.del(CURRENT_KEY);
}

/** Move a project saved by an older version (single slot) into the library. */
async function migrateLegacy(kv: KV): Promise<void> {
  const legacy = await kv.get(LEGACY_KEY);
  if (legacy === undefined) return;
  let project: Project;
  try {
    project = validateProject(legacy);
  } catch (err) {
    console.warn('Could not migrate the previously saved project; leaving it in place', err);
    return;
  }
  if ((await kv.get(keyOf(project.id))) === undefined) await saveProject(kv, project);
  await kv.del(LEGACY_KEY);
}

/** The project to open at startup: the last one open, else the most recently saved, else a new one. */
export async function openInitial(kv: KV): Promise<Project> {
  await migrateLegacy(kv);
  const current = await kv.get(CURRENT_KEY);
  if (typeof current === 'string') {
    const p = await loadProject(kv, current);
    if (p) return p;
  }
  for (const s of await listProjects(kv)) {
    const p = await loadProject(kv, s.id);
    if (p) {
      await setCurrent(kv, p.id);
      return p;
    }
  }
  const p = createDefaultProject();
  await saveProject(kv, p);
  return p;
}

/** An imported project gets its own id if one with its id is already saved, so nothing is overwritten. */
export async function prepareImport(kv: KV, project: Project): Promise<Project> {
  if ((await kv.get(keyOf(project.id))) === undefined) return project;
  return { ...project, id: newId(), name: `${project.name} (imported)` };
}

export function duplicateProject(project: Project): Project {
  return { ...project, id: newId(), name: `${project.name} (copy)` };
}
