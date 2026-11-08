import type { ConstructionSettings, DeepPartial, Project, SettingsScope } from './model';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge `patch` onto `base`, returning a new object. `undefined` values in the patch are ignored. */
export function mergeSettings<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? mergeSettings(cur, v) : v;
  }
  return out as T;
}

/**
 * Resolve effective settings for a chain of scopes, outermost first
 * (e.g. [run, tier, box]). Project settings are the root.
 * At each level: parent ⊕ style(styleId) ⊕ overrides.
 */
export function resolveSettings(project: Project, chain: readonly (SettingsScope | undefined)[]): ConstructionSettings {
  let s = project.settings;
  for (const scope of chain) {
    if (!scope) continue;
    if (scope.styleId) {
      const style = project.styles.find((st) => st.id === scope.styleId);
      if (style) s = mergeSettings(s, style.settings);
    }
    s = mergeSettings(s, scope.overrides);
  }
  return s;
}

export type SettingsPath = string; // dotted path, e.g. 'faceFrame.topRailWidth'

/** Read a dotted path from an object. */
export function getPath(obj: unknown, path: SettingsPath): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Which level in the chain supplies the effective value at `path`:
 * -1 = project settings, otherwise the index into `chain`. Useful for the inspector's
 * "inherited from …" display. Style values count as the level that references the style.
 */
export function settingSource(project: Project, chain: readonly (SettingsScope | undefined)[], path: SettingsPath): number {
  let source = -1;
  chain.forEach((scope, i) => {
    if (!scope) return;
    const style = scope.styleId ? project.styles.find((st) => st.id === scope.styleId) : undefined;
    if (getPath(style?.settings, path) !== undefined || getPath(scope.overrides, path) !== undefined) source = i;
  });
  return source;
}
