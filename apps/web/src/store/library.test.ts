import { createDefaultProject, type Project } from '@cabinet-studio/engine';
import { describe, expect, it } from 'vitest';
import { deleteProject, duplicateProject, LEGACY_KEY, listProjects, loadProject, openInitial, prepareImport, saveProject, setCurrent, type KV } from './library';

function memoryKV(seed: Record<string, unknown> = {}): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(seed));
  // Stored values are copies, as with IndexedDB's structured clone.
  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    data,
    get: async (k) => clone(data.get(k)),
    set: async (k, v) => void data.set(k, clone(v)),
    del: async (k) => void data.delete(k),
    entries: async () => [...data.entries()].map(([k, v]) => [k, clone(v)] as [unknown, unknown]),
  };
}

const named = (name: string): Project => ({ ...createDefaultProject(), name });

describe('project library', () => {
  it('starts with a new saved project when the browser has none', async () => {
    const kv = memoryKV();
    const p = await openInitial(kv);
    expect((await listProjects(kv)).map((s) => s.id)).toEqual([p.id]);
    expect(await openInitial(kv)).toMatchObject({ id: p.id });
  });

  it('moves a project saved by an older version into the library', async () => {
    const old = named('Living Room');
    const kv = memoryKV({ [LEGACY_KEY]: old });
    const p = await openInitial(kv);
    expect(p).toMatchObject({ id: old.id, name: 'Living Room' });
    expect(kv.data.has(LEGACY_KEY)).toBe(false);
    expect(await listProjects(kv)).toEqual([expect.objectContaining({ id: old.id, name: 'Living Room' })]);
  });

  it('leaves an unreadable legacy project in place', async () => {
    const kv = memoryKV({ [LEGACY_KEY]: { nonsense: true } });
    await openInitial(kv);
    expect(kv.data.has(LEGACY_KEY)).toBe(true);
  });

  it('lists projects most recently saved first and reopens the last one open', async () => {
    const kv = memoryKV();
    const a = named('A');
    const b = named('B');
    await saveProject(kv, a, 1000);
    await saveProject(kv, b, 2000);
    expect((await listProjects(kv)).map((s) => s.name)).toEqual(['B', 'A']);
    await setCurrent(kv, a.id);
    expect((await openInitial(kv)).name).toBe('A');
  });

  it('keeps each project separate', async () => {
    const kv = memoryKV();
    const a = named('A');
    const b = named('B');
    await saveProject(kv, a);
    await saveProject(kv, { ...b, name: 'B renamed' });
    expect((await loadProject(kv, a.id))?.name).toBe('A');
    expect((await loadProject(kv, b.id))?.name).toBe('B renamed');
  });

  it('falls back to the most recent project after the open one is deleted', async () => {
    const kv = memoryKV();
    const a = named('A');
    const b = named('B');
    await saveProject(kv, a, 1000);
    await saveProject(kv, b, 2000); // b is open
    await deleteProject(kv, b.id);
    expect(await loadProject(kv, b.id)).toBeNull();
    expect((await openInitial(kv)).name).toBe('A');
  });

  it('imports a file as a copy when a project with its id is already saved', async () => {
    const kv = memoryKV();
    const a = named('A');
    expect(await prepareImport(kv, a)).toBe(a);
    await saveProject(kv, a);
    const again = await prepareImport(kv, a);
    expect(again.id).not.toBe(a.id);
    expect(again.name).toBe('A (imported)');
  });

  it('duplicates with a new id and name', () => {
    const a = named('A');
    expect(duplicateProject(a)).toMatchObject({ name: 'A (copy)', runs: a.runs });
    expect(duplicateProject(a).id).not.toBe(a.id);
  });
});
