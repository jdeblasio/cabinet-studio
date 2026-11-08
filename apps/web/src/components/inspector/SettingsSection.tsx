import {
  clearOverride,
  findBox,
  findSpan,
  findTier,
  getPath,
  resolveSettings,
  setOverride,
  setProjectSetting,
  settingSource,
  type Id,
  type Project,
  type SettingsScope,
  type Ticks,
} from '@built-in-planner/engine';
import { useEditor } from '../../store/store';
import { LengthInput, Section, Select } from './fields';

type SettingDef =
  | { path: string; label: string; type: 'length' }
  | { path: string; label: string; type: 'select'; options: readonly (readonly [string, string])[] };

const END_STILE_OPTIONS = [
  ['flush', 'Flush stile'],
  ['full', 'Full-width stile'],
] as const;

const CARCASS_END_OPTIONS = [
  ['panel', 'Panel'],
  ['open', 'Open (no panel or rail)'],
] as const;

const SETTINGS: SettingDef[] = [
  {
    path: 'construction',
    label: 'Construction',
    type: 'select',
    options: [
      ['faceFrame', 'Face frame'],
      ['frameless', 'Frameless'],
    ],
  },
  {
    path: 'fronts.mounting',
    label: 'Front mounting',
    type: 'select',
    options: [
      ['partialOverlay', 'Partial overlay'],
      ['fullOverlay', 'Full overlay'],
      ['inset', 'Inset'],
    ],
  },
  { path: 'fronts.overlay', label: 'Overlay', type: 'length' },
  { path: 'fronts.reveal', label: 'Reveal', type: 'length' },
  { path: 'fronts.pairGap', label: 'Pair gap', type: 'length' },
  { path: 'faceFrame.topRailWidth', label: 'Top rail', type: 'length' },
  { path: 'faceFrame.bottomRailWidth', label: 'Bottom rail', type: 'length' },
  { path: 'faceFrame.midRailWidth', label: 'Mid rail', type: 'length' },
  { path: 'faceFrame.midStileWidth', label: 'Mid stile', type: 'length' },
  // Only affects edges with no neighbor and no wall (beside a gap, at an open end).
  { path: 'faceFrame.endStiles.left', label: 'Open left end', type: 'select', options: END_STILE_OPTIONS },
  { path: 'faceFrame.endStiles.right', label: 'Open right end', type: 'select', options: END_STILE_OPTIONS },
  { path: 'faceFrame.lip', label: 'Frame lip', type: 'length' },
  { path: 'faceFrame.scribeAllowance', label: 'Scribe allowance', type: 'length' },
  { path: 'carcass.top', label: 'Top', type: 'select', options: CARCASS_END_OPTIONS },
  { path: 'carcass.bottom', label: 'Bottom', type: 'select', options: CARCASS_END_OPTIONS },
  {
    path: 'back',
    label: 'Back',
    type: 'select',
    options: [
      ['applied', 'Applied'],
      ['none', 'None'],
    ],
  },
  { path: 'ceilingScribe', label: 'Ceiling scribe', type: 'length' },
];

/** Where a settings edit lands: the project root, or an override on a run/tier/box/span. */
export type ScopeRef =
  | { kind: 'project' }
  | { kind: 'run'; runId: Id }
  | { kind: 'tier'; runId: Id; tierId: Id }
  | { kind: 'box'; runId: Id; boxId: Id }
  | { kind: 'span'; runId: Id; spanId: Id };

const LEVEL_NAMES: Record<ScopeRef['kind'], string> = {
  project: 'project',
  run: 'run',
  tier: 'tier',
  box: 'box',
  span: 'tall box',
};

/** The cascade chain (outermost first, excluding the project root) for a scope, with level names. */
function chainFor(project: Project, ref: ScopeRef): { chain: SettingsScope[]; names: string[] } | null {
  if (ref.kind === 'project') return { chain: [], names: [] };
  const run = project.runs.find((r) => r.id === ref.runId);
  if (!run) return null;
  switch (ref.kind) {
    case 'run':
      return { chain: [run], names: ['run'] };
    case 'tier': {
      const tier = findTier(run, ref.tierId);
      return tier ? { chain: [run, tier], names: ['run', 'tier'] } : null;
    }
    case 'box': {
      const hit = findBox(run, ref.boxId);
      return hit ? { chain: [run, hit.tier, hit.box], names: ['run', 'tier', 'box'] } : null;
    }
    case 'span': {
      // Matches the engine: spans inherit from the run directly.
      const span = findSpan(run, ref.spanId);
      return span ? { chain: [run, span], names: ['run', 'tall box'] } : null;
    }
  }
}

function scopeInDraft(draft: Project, ref: ScopeRef): SettingsScope | undefined {
  if (ref.kind === 'project') return undefined;
  const run = draft.runs.find((r) => r.id === ref.runId);
  if (!run) return undefined;
  switch (ref.kind) {
    case 'run':
      return run;
    case 'tier':
      return findTier(run, ref.tierId);
    case 'box':
      return findBox(run, ref.boxId)?.box;
    case 'span':
      return findSpan(run, ref.spanId);
  }
}

export function SettingsSection({ scope, title }: { scope: ScopeRef; title?: string }) {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const info = chainFor(project, scope);
  if (!info) return null;
  const { chain, names } = info;
  const effective = resolveSettings(project, chain);
  const here = chain.length - 1;

  const setValue = (path: string, value: unknown) =>
    edit((d) => {
      if (scope.kind === 'project') setProjectSetting(d, path, value);
      else {
        const s = scopeInDraft(d, scope);
        if (s) setOverride(s, path, value);
      }
    });
  const reset = (path: string) =>
    edit((d) => {
      const s = scopeInDraft(d, scope);
      if (s) clearOverride(s, path);
    });

  return (
    <Section title={title ?? `Construction (${LEVEL_NAMES[scope.kind]})`}>
      <div className="settings-grid">
        {SETTINGS.map((def) => {
          const value = getPath(effective, def.path);
          const source = scope.kind === 'project' ? -1 : settingSource(project, chain, def.path);
          const overridden = scope.kind !== 'project' && source === here;
          const from = source === -1 ? 'project' : names[source];
          return (
            <div key={def.path} className={`setting${overridden ? ' overridden' : ''}`}>
              <span className="field-label">{def.label}</span>
              <span className="field-control">
                {def.type === 'length' ? (
                  <LengthInput value={value as Ticks} onCommit={(t) => setValue(def.path, t)} ariaLabel={def.label} />
                ) : (
                  <Select value={value as string} options={def.options} onChange={(v) => setValue(def.path, v)} ariaLabel={def.label} />
                )}
              </span>
              <span className="setting-source">
                {scope.kind === 'project' ? null : overridden ? (
                  <button className="link" title="Reset to inherited value" onClick={() => reset(def.path)}>
                    reset
                  </button>
                ) : (
                  <span className="muted" title={`Inherited from ${from}`}>
                    {from}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
