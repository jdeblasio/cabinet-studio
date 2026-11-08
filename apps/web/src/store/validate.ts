import { DEFAULT_MATERIALS, DEFAULT_SETTINGS, mergeSettings, SCHEMA_VERSION, type Project } from '@cabinet-studio/engine';

/** Check an unknown value is a usable project and normalize it. Throws with a readable message. */
export function validateProject(data: unknown): Project {
  if (typeof data !== 'object' || data === null) throw new Error('Not a project file.');
  const p = data as Partial<Project>;
  if (p.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      p.schemaVersion === undefined
        ? 'Not a Cabinet Studio project (no schemaVersion).'
        : `Unsupported project version ${String(p.schemaVersion)} (this app reads version ${SCHEMA_VERSION}).`,
    );
  }
  if (typeof p.id !== 'string' || p.id === '') throw new Error('Project has no id.');
  if (!Array.isArray(p.runs) || p.runs.length === 0) throw new Error('Project has no wall runs.');
  if (!p.units || (p.units.system !== 'imperial' && p.units.system !== 'metric')) throw new Error('Project units are missing or invalid.');
  if (!Array.isArray(p.materials)) throw new Error('Project materials are missing.');
  for (const run of p.runs) {
    if (!Array.isArray(run.tiers) || !Array.isArray(run.wall) || run.wall.length === 0) throw new Error(`Run "${run.name ?? run.id}" is malformed.`);
  }
  // Fill in settings added since the file was written, and any default materials they refer to.
  const settings = mergeSettings(DEFAULT_SETTINGS, p.settings);
  const used = new Set(Object.values(settings.materials));
  const materials = [...p.materials, ...DEFAULT_MATERIALS.filter((m) => used.has(m.id) && !p.materials!.some((pm) => pm.id === m.id))];
  return {
    ...(p as Project),
    name: typeof p.name === 'string' ? p.name : 'Untitled built-in',
    styles: Array.isArray(p.styles) ? p.styles : [],
    runs: p.runs.map((run) => (Array.isArray(run.spans) ? run : { ...run, spans: [] })),
    settings,
    materials,
  };
}
