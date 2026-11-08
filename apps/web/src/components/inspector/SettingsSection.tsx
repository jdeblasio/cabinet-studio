import {
  clearOverride,
  findBox,
  findSpan,
  findTier,
  getPath,
  hardwareOf,
  finishesOf,
  NATURAL,
  resolveSettings,
  clearStyleSetting,
  saveOverridesAsStyle,
  setOverride,
  setProjectSetting,
  setScopeStyle,
  setStyleSetting,
  type Id,
  type Project,
  type SettingsScope,
  type Ticks,
} from '@cabinet-studio/engine';
import { useFormatter } from '../../lib/units';
import { useEditor } from '../../store/store';
import { LengthInput, NumberInput, Section, Select } from './fields';

/** One row of the settings list. `tip` is a short description shown on hover. */
type SettingDef =
  | { path: string; label: string; tip: string; type: 'length' }
  | { path: string; label: string; tip: string; type: 'number'; unit: string; min: number }
  | { path: string; label: string; tip: string; type: 'material' }
  | { path: string; label: string; tip: string; type: 'finish' }
  | { path: string; label: string; tip: string; type: 'hardware'; kind: 'slides' | 'hinges' | 'shelfPins' }
  | { path: string; label: string; tip: string; type: 'select'; options: readonly (readonly [string, string])[] };

const END_STILE_OPTIONS = [
  ['flush', 'Flush stile'],
  ['full', 'Full-width stile'],
] as const;

const FRONT_STYLE_OPTIONS = [
  ['slab', 'Slab'],
  ['fivePiece', 'Five-piece (Shaker)'],
] as const;

const CARCASS_END_OPTIONS = [
  ['panel', 'Panel'],
  ['open', 'Open (no panel or rail)'],
] as const;

const SETTINGS: SettingDef[] = [
  {
    path: 'construction',
    label: 'Construction',
    tip: 'Face frame: a hardwood frame across the front of the boxes; fronts sit on the frame. Frameless (European): no frame; fronts sit on the box edges (usually full overlay), with fillers at walls.',
    type: 'select',
    options: [
      ['faceFrame', 'Face frame'],
      ['frameless', 'Frameless'],
    ],
  },
  {
    path: 'joinery',
    label: 'Carcass joints',
    tip: 'How tops, bottoms, fixed shelves and partitions join the sides. Butt, dowel and confirmat: parts meet flat (no size change). Dado and rabbet: parts sit in grooves, so they are cut longer by the joint depth at each end.',
    type: 'select',
    options: [
      ['butt', 'Butt (screws/pocket)'],
      ['dowel', 'Dowel'],
      ['confirmat', 'Confirmat'],
      ['dado', 'Dado'],
      ['rabbet', 'Rabbet (top/bottom)'],
    ],
  },
  { path: 'joineryDepth', label: 'Joint depth', tip: 'Depth of dados and rabbets: how far captured parts extend into the sides.', type: 'length' },
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
  {
    path: 'fronts.doorStyle',
    label: 'Door style',
    tip: 'Slab: one flat panel. Five-piece (Shaker): two stiles and two rails around a floating panel.',
    type: 'select',
    options: FRONT_STYLE_OPTIONS,
  },
  {
    path: 'fronts.drawerStyle',
    label: 'Drawer front style',
    tip: 'Slab: one flat panel. Five-piece (Shaker): a frame and panel; fronts too short for a frame stay slab.',
    type: 'select',
    options: FRONT_STYLE_OPTIONS,
  },
  { path: 'fronts.fivePiece.stileWidth', label: '5-piece stile', tip: 'Width of the stiles (vertical frame pieces) of five-piece fronts.', type: 'length' },
  { path: 'fronts.fivePiece.railWidth', label: '5-piece rail', tip: 'Width of the rails (horizontal frame pieces) of five-piece fronts.', type: 'length' },
  { path: 'fronts.fivePiece.panelGroove', label: 'Panel groove', tip: 'Depth of the groove that holds the panel. Rails get stub tenons this long on each end.', type: 'length' },
  { path: 'fronts.fivePiece.panelClearance', label: 'Panel clearance', tip: 'Gap per side between the panel and the bottom of its groove, for seasonal movement.', type: 'length' },
  { path: 'hardware.slide', label: 'Drawer slides', tip: 'Slide type from the project\'s hardware library. Its side clearance sets the drawer box width; the box depth is its longest length that fits.', type: 'hardware', kind: 'slides' },
  { path: 'hardware.hinge', label: 'Hinges', tip: 'Hinge type from the hardware library (for the shopping list and, later, drilling).', type: 'hardware', kind: 'hinges' },
  { path: 'hardware.shelfPin', label: 'Shelf pins', tip: 'Shelf pin type from the hardware library (for the shopping list and, later, drilling).', type: 'hardware', kind: 'shelfPins' },
  { path: 'drawers.topClearance', label: 'Drawer top gap', tip: 'Space between the top of the drawer box and the top of the frame opening.', type: 'length' },
  { path: 'drawers.bottomClearance', label: 'Drawer bottom gap', tip: 'Space between the bottom of the drawer box and the bottom of the frame opening.', type: 'length' },
  { path: 'drawers.rearClearance', label: 'Drawer rear gap', tip: 'Minimum space behind the drawer box. The box depth is the longest standard slide (10" to 24") that fits.', type: 'length' },
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
    path: 'carcass.topJoint',
    label: 'Top joint',
    tip: 'How the top meets the sides and back. Between the sides: the sides run full height (their top edges show if nothing covers them, e.g. on a ledge in front of shallower uppers). Over the sides: the top runs over the sides and back, hiding their top edges (its own ends show instead, unless a neighbor or wall covers them). Auto: per box and corner, whichever hides more raw edges.',
    type: 'select',
    options: [
      ['between', 'Between the sides'],
      ['over', 'Over the sides'],
      ['auto', 'Auto (hide raw edges)'],
    ],
  },
  {
    path: 'carcass.bottomJoint',
    label: 'Bottom joint',
    tip: 'How the bottom meets the sides and back, where the bottom panel is at the bottom of the box (frameless boxes, and the finished bottom of a box over a doorway or open space). Under the sides: the sides and back sit on it, hiding their bottom edges. Auto: per box and corner, whichever hides more raw edges. A bottom raised above the bottom rail always sits between the sides.',
    type: 'select',
    options: [
      ['between', 'Between the sides'],
      ['under', 'Under the sides'],
      ['auto', 'Auto (hide raw edges)'],
    ],
  },
  {
    path: 'back',
    label: 'Back',
    tip: 'Applied: a back panel over the whole rear of each box (its edges show at an open end). Rabbeted: set into rabbets in the sides, top and bottom, which run full depth and hide its edges. None: no back.',
    type: 'select',
    options: [
      ['applied', 'Applied'],
      ['rabbeted', 'Rabbeted'],
      ['none', 'None'],
    ],
  },
  {
    path: 'shelves.fixedEdge',
    label: 'Fixed shelf edge',
    tip: "How a fixed shelf's front edge is covered. Flush: a rail in the face frame, flush with it, its top flush with the shelf. Inset: the rail (and shelf) set back from the frame face by the setback below. Frameless boxes have no rail; the shelf front is flush or set back. Behind an inset door the rail always sits behind the door.",
    type: 'select',
    options: [
      ['flush', 'Flush rail'],
      ['inset', 'Inset rail'],
    ],
  },
  {
    path: 'shelves.adjustableFront',
    label: 'Adjustable shelf front',
    tip: "Banded: edge banding on the front (when edge banding is on). Frame nosing: a strip of face frame lumber on the front, as tall as a mid rail and placed like a fixed shelf's rail, so adjustable shelves look like fixed ones. The nosing stiffens the shelf (the sag check counts it) but hangs below it, so spaces between shelves look shorter; it has to fit through the opening, so it's a little narrower than the opening.",
    type: 'select',
    options: [
      ['banded', 'Banded edge'],
      ['nosing', 'Frame nosing'],
    ],
  },
  { path: 'shelves.fixedSetback', label: 'Fixed shelf setback', tip: 'How far an inset fixed shelf rail sits back from the face of the frame.', type: 'length' },
  { path: 'shelves.designLoad', label: 'Shelf load', tip: 'Load for the shelf sag check, in pounds per square foot of shelf. 20 is roughly a full shelf of books.', type: 'number', unit: 'lb/ft²', min: 0 },
  { path: 'shelves.maxSagPerFoot', label: 'Max shelf sag', tip: 'Largest acceptable shelf sag, in inches per foot of span. 0.02 is about where sag becomes visible.', type: 'number', unit: 'in/ft', min: 0.001 },
  {
    path: 'edgeBanding.enabled',
    label: 'Edge banding',
    tip: 'Band exposed plywood edges: adjustable shelf fronts, slab doors and drawer fronts all round, and (frameless) the carcass front edges. The cut list shows the banding.',
    type: 'select',
    options: [
      ['true', 'On'],
      ['false', 'Off'],
    ],
  },
  {
    path: 'edgeBanding.exposed',
    label: 'Band exposed edges',
    tip: 'Also band any other plywood edge left showing: not covered by another part, a neighboring box, the wall, floor or ceiling gap (e.g. the tops of base cabinet sides in front of shallower uppers, or the bottoms of a box over a doorway). With the edge highlight on, these show as raw edges until banded.',
    type: 'select',
    options: [
      ['false', 'Off'],
      ['true', 'On'],
    ],
  },
  { path: 'edgeBanding.thickness', label: 'Banding thickness', tip: 'Banded parts are cut this much smaller per banded edge. 0 for iron-on veneer tape; e.g. 1/4" for solid wood edging.', type: 'length' },
  {
    path: 'splitOversize',
    label: 'Split oversize parts',
    tip: "Parts bigger than your stock (a sheet less its edge trim, or the longest board; see Sheet layouts) are pieced with as few joints as possible, hidden where they can be: on a partition or fixed shelf, behind a partition for backs, at a mid stile (which then runs through the rail), or over the joint between boxes for countertops. Off: they're reported as problems.",
    type: 'select',
    options: [
      ['false', 'Off (report them)'],
      ['true', 'Split at hidden joints'],
    ],
  },
  { path: 'ceilingScribe', label: 'Ceiling scribe', tip: 'Space left at the ceiling above the top tier, for scribing to an uneven ceiling.', type: 'length' },
  // Which material (and so which thickness) each kind of part uses.
  { path: 'materials.carcass', label: 'Carcass material', tip: 'Material for box sides, tops, bottoms, partitions and end panels. Its thickness sets theirs.', type: 'material' },
  { path: 'finishes.carcass', label: 'Carcass finish', tip: 'Paint or finish over the carcass material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.back', label: 'Back material', tip: 'Material for box backs.', type: 'material' },
  { path: 'finishes.back', label: 'Back finish', tip: 'Paint or finish over the back material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.shelves', label: 'Shelf material', tip: 'Material for fixed and adjustable shelves.', type: 'material' },
  { path: 'finishes.shelves', label: 'Shelf finish', tip: 'Paint or finish over the shelf material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.faceFrame', label: 'Face frame material', tip: 'Lumber for face frame stiles and rails.', type: 'material' },
  { path: 'finishes.faceFrame', label: 'Face frame finish', tip: 'Paint or finish over the face frame material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.fronts', label: 'Door/drawer material', tip: 'Material for slab doors and drawer fronts.', type: 'material' },
  { path: 'finishes.fronts', label: 'Door/drawer finish', tip: 'Paint or finish over the door/drawer material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.toeKick', label: 'Toe kick material', tip: 'Material for the toe kick platform and kick boards.', type: 'material' },
  { path: 'finishes.toeKick', label: 'Toe kick finish', tip: 'Paint or finish over the toe kick material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.countertop', label: 'Countertop material', tip: 'Material (species and color) for countertops. Thickness is set on the tier.', type: 'material' },
  { path: 'finishes.countertop', label: 'Countertop finish', tip: 'Paint or finish over the countertop material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.molding', label: 'Molding material', tip: 'Stock for crown and base molding (bought by length).', type: 'material' },
  { path: 'finishes.molding', label: 'Molding finish', tip: 'Paint or finish over the molding material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.drawerBox', label: 'Drawer box material', tip: 'Material for drawer box sides, fronts and backs.', type: 'material' },
  { path: 'finishes.drawerBox', label: 'Drawer box finish', tip: 'Paint or finish over the drawer box material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.drawerBottom', label: 'Drawer bottom material', tip: 'Material for drawer bottoms.', type: 'material' },
  { path: 'finishes.drawerBottom', label: 'Drawer bottom finish', tip: 'Paint or finish over the drawer bottom material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.frontFrame', label: '5-piece frame material', tip: 'Lumber for the stiles and rails of five-piece doors and drawer fronts.', type: 'material' },
  { path: 'finishes.frontFrame', label: '5-piece frame finish', tip: 'Paint or finish over the 5-piece frame material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
  { path: 'materials.frontPanel', label: '5-piece panel material', tip: 'Material for the panels of five-piece doors and drawer fronts.', type: 'material' },
  { path: 'finishes.frontPanel', label: '5-piece panel finish', tip: 'Paint or finish over the 5-piece panel material: one of the project\'s paints and finishes (Project tab), or Natural for the material\'s own look.', type: 'finish' },
];

/** Where a settings edit lands: the project root, an override on a run/tier/box/span, or a named style. */
export type ScopeRef =
  | { kind: 'project' }
  | { kind: 'style'; styleId: Id }
  | { kind: 'run'; runId: Id }
  | { kind: 'tier'; runId: Id; tierId: Id }
  | { kind: 'box'; runId: Id; boxId: Id }
  | { kind: 'span'; runId: Id; spanId: Id };

const LEVEL_NAMES: Record<ScopeRef['kind'], string> = {
  project: 'project',
  style: 'style',
  run: 'run',
  tier: 'tier',
  box: 'box',
  span: 'tall box',
};

/** The cascade chain (outermost first, excluding the project root) for a scope, with level names. */
function chainFor(project: Project, ref: ScopeRef): { chain: SettingsScope[]; names: string[] } | null {
  if (ref.kind === 'project') return { chain: [], names: [] };
  if (ref.kind === 'style') {
    // A style is edited like an override layer straight on top of the project settings.
    const style = project.styles.find((st) => st.id === ref.styleId);
    return style ? { chain: [{ overrides: style.settings }], names: ['style'] } : null;
  }
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
  if (ref.kind === 'project' || ref.kind === 'style') return undefined;
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

/** "a", "a or b", "a, b or c". */
const orList = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);

export function SettingsSection({ scope, title }: { scope: ScopeRef; title?: string }) {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const showAllSetting = useEditor((s) => s.showAllSettings);
  const setShowAll = useEditor((s) => s.setShowAllSettings);
  const { fmt } = useFormatter();
  const info = chainFor(project, scope);
  if (!info) return null;
  const { chain, names } = info;
  const effective = resolveSettings(project, chain);
  const materialOptions = (current: string): (readonly [string, string])[] => {
    const opts = project.materials.map((m) => [m.id, `${m.name} · ${fmt(m.thickness)}`] as const);
    return opts.some(([id]) => id === current) ? opts : [[current, '(missing material)'], ...opts];
  };
  const finishOptions = (current: string): (readonly [string, string])[] => {
    const opts: (readonly [string, string])[] = [[NATURAL, 'Natural'], ...finishesOf(project).map((f) => [f.id, f.name] as const)];
    return opts.some(([id]) => id === current) || current === undefined ? opts : [[current, '(missing finish)'], ...opts];
  };
  const here = chain.length - 1;

  const setValue = (path: string, value: unknown) =>
    edit((d) => {
      if (scope.kind === 'project') setProjectSetting(d, path, value);
      else if (scope.kind === 'style') {
        const st = d.styles.find((x) => x.id === scope.styleId);
        if (st) setStyleSetting(st, path, value);
      } else {
        const s = scopeInDraft(d, scope);
        if (s) setOverride(s, path, value);
      }
    });
  const reset = (path: string) =>
    edit((d) => {
      if (scope.kind === 'style') {
        const st = d.styles.find((x) => x.id === scope.styleId);
        if (st) clearStyleSetting(st, path);
        return;
      }
      const s = scopeInDraft(d, scope);
      if (s) clearOverride(s, path);
    });

  /** Where a value comes from: an override at some level, a style applied at some level, or the project. */
  const sourceOf = (path: string): { level: number; style?: string } => {
    for (let i = chain.length - 1; i >= 0; i--) {
      const sc = chain[i]!;
      if (getPath(sc.overrides, path) !== undefined) return { level: i };
      const st = sc.styleId ? project.styles.find((x) => x.id === sc.styleId) : undefined;
      if (st && getPath(st.settings, path) !== undefined) return { level: i, style: st.name };
    }
    return { level: -1 };
  };

  const current = scope.kind === 'project' || scope.kind === 'style' ? undefined : chain[here];
  const styleControls = current ? (
    <span className="style-controls">
      <select
        className="input"
        aria-label="Style"
        title="Apply a named style (a reusable set of settings) here. Overrides below still win."
        value={current.styleId ?? ''}
        onChange={(e) =>
          edit((d) => {
            const s = scopeInDraft(d, scope);
            if (s) setScopeStyle(s, e.target.value || undefined);
          })
        }
      >
        <option value="">No style</option>
        {project.styles.map((st) => (
          <option key={st.id} value={st.id}>
            {st.name}
          </option>
        ))}
      </select>
      {current.overrides && Object.keys(current.overrides).length > 0 && (
        <button
          className="link"
          title="Turn this level's overrides into a new named style and apply it here"
          onClick={() =>
            edit((d) => {
              const s = scopeInDraft(d, scope);
              if (s) saveOverridesAsStyle(d, s, `${LEVEL_NAMES[scope.kind]} style ${d.styles.length + 1}`.replace(/^./, (c) => c.toUpperCase()));
            })
          }
        >
          Save as style
        </button>
      )}
    </span>
  ) : undefined;

  // Runs, tiers and boxes list only their own overrides unless asked for everything; the project
  // defaults and styles (on the Project tab) always list every setting.
  const collapsible = scope.kind !== 'project' && scope.kind !== 'style';
  const showAll = !collapsible || showAllSetting;
  const isOverride = (path: string) => {
    const src = sourceOf(path);
    return src.level === here && !src.style;
  };
  const overrideCount = collapsible ? SETTINGS.filter((def) => isOverride(def.path)).length : 0;
  const rows = showAll ? SETTINGS : SETTINGS.filter((def) => isOverride(def.path));

  return (
    <Section title={title ?? `Construction (${LEVEL_NAMES[scope.kind]})`} actions={styleControls}>
      {collapsible && !showAll && overrideCount === 0 && (
        <p className="muted small">
          {current?.styleId ? 'Uses its style; no other overrides here.' : `Everything is inherited from the ${orList([...names.slice(0, here), 'project'])}.`}
        </p>
      )}
      <div className="settings-grid">
        {rows.map((def) => {
          const value = getPath(effective, def.path);
          const src = scope.kind === 'project' ? { level: -1 } : sourceOf(def.path);
          const overridden = scope.kind !== 'project' && src.level === here && !src.style;
          const from = src.style ?? (src.level === -1 ? 'project' : names[src.level]);
          return (
            <div key={def.path} className={`setting${overridden ? ' overridden' : ''}`} title={def.tip}>
              <span className="field-label">{def.label}</span>
              <span className="field-control">
                {def.type === 'length' ? (
                  <LengthInput value={value as Ticks} onCommit={(t) => setValue(def.path, t)} ariaLabel={def.label} />
                ) : def.type === 'number' ? (
                  <span className="pair">
                    <NumberInput value={value as number} min={def.min} onCommit={(n) => setValue(def.path, n)} ariaLabel={def.label} />
                    <span className="muted">{def.unit}</span>
                  </span>
                ) : def.type === 'hardware' ? (
                  <Select
                    value={value as string}
                    options={(() => {
                      const opts = hardwareOf(project)[def.kind].map((h) => [h.id, h.name] as const);
                      return opts.some(([hid]) => hid === value) ? opts : [[value as string, '(missing)'] as const, ...opts];
                    })()}
                    onChange={(v) => setValue(def.path, v)}
                    ariaLabel={def.label}
                  />
                ) : def.type === 'finish' ? (
                  <Select value={value as string} options={finishOptions(value as string)} onChange={(v) => setValue(def.path, v)} ariaLabel={def.label} />
                ) : def.type === 'material' ? (
                  <Select value={value as string} options={materialOptions(value as string)} onChange={(v) => setValue(def.path, v)} ariaLabel={def.label} />
                ) : typeof value === 'boolean' ? (
                  <Select value={String(value)} options={def.options} onChange={(v) => setValue(def.path, v === 'true')} ariaLabel={def.label} />
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
      {collapsible && (
        <div className="settings-toggle">
          <button
            className="link"
            title={showAll ? 'List only the settings overridden here' : 'List every construction setting, to override any of them here'}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? (overrideCount ? `Show only the ${overrideCount} override${overrideCount === 1 ? '' : 's'}` : 'Show overrides only') : `Show all ${SETTINGS.length} settings`}
          </button>
        </div>
      )}
    </Section>
  );
}
