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
import { useFormatter } from '../../lib/units';
import { useEditor } from '../../store/store';
import { LengthInput, Section, Select } from './fields';

/** One row of the settings list. `tip` is a short description shown on hover. */
type SettingDef =
  | { path: string; label: string; tip: string; type: 'length' }
  | { path: string; label: string; tip: string; type: 'material' }
  | { path: string; label: string; tip: string; type: 'select'; options: readonly (readonly [string, string])[] };

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
    tip: 'Face frame: a hardwood frame across the front of the boxes. Frameless (European) construction arrives in a later milestone; face frame is shown for now.',
    type: 'select',
    options: [
      ['faceFrame', 'Face frame'],
      ['frameless', 'Frameless'],
    ],
  },
  {
    path: 'fronts.mounting',
    label: 'Front mounting',
    tip: 'How doors and drawer fronts sit. Partial overlay: lapped onto the face frame. Full overlay: covering nearly all of the frame. Inset: inside the frame openings, flush with the frame.',
    type: 'select',
    options: [
      ['partialOverlay', 'Partial overlay'],
      ['fullOverlay', 'Full overlay'],
      ['inset', 'Inset'],
    ],
  },
  { path: 'fronts.overlay', label: 'Overlay', tip: 'Partial overlay: how far each door or drawer front laps onto the face frame on each side.', type: 'length' },
  { path: 'fronts.reveal', label: 'Reveal', tip: 'Inset: the gap around each front. Full overlay: the gap between neighboring fronts.', type: 'length' },
  { path: 'fronts.pairGap', label: 'Pair gap', tip: 'The gap between the two doors of a pair.', type: 'length' },
  { path: 'faceFrame.topRailWidth', label: 'Top rail', tip: 'Height of the face frame rail along the top of each box.', type: 'length' },
  { path: 'faceFrame.bottomRailWidth', label: 'Bottom rail', tip: 'Height of the face frame rail along the bottom of each box. The bottom panel sits flush with its top edge.', type: 'length' },
  { path: 'faceFrame.midRailWidth', label: 'Mid rail', tip: 'Height of the rail between stacked openings (e.g. a drawer over a door).', type: 'length' },
  // Stiles over partitions match shared stiles; this is for stile-only dividers.
  { path: 'faceFrame.midStileWidth', label: 'Stile-only divider', tip: 'Width of the stile between side-by-side openings when there\'s no partition behind it. Stiles over partitions match the stiles shared between boxes.', type: 'length' },
  // Only affects edges with no neighbor and no wall (beside a gap, at an open end).
  { path: 'faceFrame.endStiles.left', label: 'Open left end', tip: 'The stile on a box\'s left edge when nothing is beside it (a gap or an open end). Flush: stops at the box side. Full width: as wide as a shared stile so it lines up with stiles above or below; the boxes shrink to make room and an end panel fills in behind it.', type: 'select', options: END_STILE_OPTIONS },
  { path: 'faceFrame.endStiles.right', label: 'Open right end', tip: 'The stile on a box\'s right edge when nothing is beside it (a gap or an open end). Flush: stops at the box side. Full width: as wide as a shared stile so it lines up with stiles above or below; the boxes shrink to make room and an end panel fills in behind it.', type: 'select', options: END_STILE_OPTIONS },
  { path: 'faceFrame.lip', label: 'Frame lip', tip: 'How far the face frame overhangs the inside of each box side. 0 is flush inside, so drawer slides mount without spacers.', type: 'length' },
  { path: 'faceFrame.scribeAllowance', label: 'Scribe allowance', tip: 'Space left between a wall and the end box. The end stile covers it and is scribed to the wall.', type: 'length' },
  { path: 'carcass.top', label: 'Top', tip: 'Panel: a top panel and top rail. Open: neither, so shelving continues into the box above.', type: 'select', options: CARCASS_END_OPTIONS },
  { path: 'carcass.bottom', label: 'Bottom', tip: 'Panel: a bottom panel and bottom rail. Open: neither, e.g. so a countertop below shows as the bottom shelf.', type: 'select', options: CARCASS_END_OPTIONS },
  {
    path: 'back',
    label: 'Back',
    tip: 'Applied: a back panel on the rear of each box. None: no back.',
    type: 'select',
    options: [
      ['applied', 'Applied'],
      ['none', 'None'],
    ],
  },
  { path: 'ceilingScribe', label: 'Ceiling scribe', tip: 'Space left at the ceiling above the top tier, for scribing to an uneven ceiling.', type: 'length' },
  // Which material (and so which thickness) each kind of part uses.
  { path: 'materials.carcass', label: 'Carcass material', tip: 'Material for box sides, tops, bottoms, partitions and end panels. Its thickness sets theirs.', type: 'material' },
  { path: 'materials.back', label: 'Back material', tip: 'Material for box backs.', type: 'material' },
  { path: 'materials.shelves', label: 'Shelf material', tip: 'Material for fixed and adjustable shelves.', type: 'material' },
  { path: 'materials.faceFrame', label: 'Face frame material', tip: 'Lumber for face frame stiles and rails.', type: 'material' },
  { path: 'materials.fronts', label: 'Door/drawer material', tip: 'Material for slab doors and drawer fronts.', type: 'material' },
  { path: 'materials.toeKick', label: 'Toe kick material', tip: 'Material for the toe kick platform and kick boards.', type: 'material' },
  { path: 'materials.countertop', label: 'Countertop material', tip: 'Material (species and color) for countertops. Thickness is set on the tier.', type: 'material' },
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
  const { fmt } = useFormatter();
  const info = chainFor(project, scope);
  if (!info) return null;
  const { chain, names } = info;
  const effective = resolveSettings(project, chain);
  const materialOptions = (current: string): (readonly [string, string])[] => {
    const opts = project.materials.map((m) => [m.id, `${m.name} · ${fmt(m.thickness)}`] as const);
    return opts.some(([id]) => id === current) ? opts : [[current, '(missing material)'], ...opts];
  };
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
            <div key={def.path} className={`setting${overridden ? ' overridden' : ''}`} title={def.tip}>
              <span className="field-label">{def.label}</span>
              <span className="field-control">
                {def.type === 'length' ? (
                  <LengthInput value={value as Ticks} onCommit={(t) => setValue(def.path, t)} ariaLabel={def.label} />
                ) : def.type === 'material' ? (
                  <Select value={value as string} options={materialOptions(value as string)} onChange={(v) => setValue(def.path, v)} ariaLabel={def.label} />
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
