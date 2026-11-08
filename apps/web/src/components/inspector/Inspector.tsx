import {
  addBox,
  addMaterial,
  addStyle,
  removeStyle,
  renameStyle,
  styleUsage,
  addSpan,
  addSplitChild,
  addTier,
  DEFAULT_GRID,
  findBox,
  findSectionInRun,
  findSpan,
  findTier,
  inches,
  materialUsage,
  removeBox,
  removeMaterial,
  removeSection,
  removeSpan,
  removeTier,
  setAdjustableShelves,
  setBoxName,
  setBoxWidth,
  setCeilingHeight,
  setEndCondition,
  setFront,
  setSpanGeometry,
  setSpanTiers,
  setSplitChildSize,
  setSplitDivider,
  setTierDepth,
  setTierHeight,
  setTierKind,
  setTierName,
  setToeKick,
  setCountertop,
  DEFAULT_COUNTERTOP,
  setWallLength,
  splitOpening,
  unsplit,
  updateMaterial,
  type Front,
  type Id,
  type Opening,
  type Project,
  type Run,
  type RunResult,
  type Span,
  type Split,
  type Tier,
} from '@built-in-planner/engine';
import { useEffect, useState } from 'react';
import { useFormatter } from '../../lib/units';
import { useRunResult } from '../../store/derived';
import { useActiveRun, useEditor } from '../../store/store';
import { Field, LengthInput, NumberInput, Section, Segmented, Select, SizeSpecEditor, TextInput } from './fields';
import { SettingsSection } from './SettingsSection';

function useEditRun() {
  const edit = useEditor((s) => s.edit);
  const runId = useEditor((s) => s.activeRunId);
  return (fn: (run: Run, project: Project) => void) =>
    edit((d) => {
      const r = d.runs.find((x) => x.id === runId);
      if (r) fn(r, d);
    });
}

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const run = useActiveRun();
  const result = useRunResult();

  let body;
  if (!selection || selection.kind === 'run') body = <RunPanel run={run} result={result} />;
  else if (selection.kind === 'tier') {
    const tier = findTier(run, selection.tierId);
    body = tier ? <TierPanel run={run} tier={tier} result={result} /> : null;
  } else if (selection.kind === 'box') {
    body = <BoxPanel run={run} boxId={selection.boxId} result={result} />;
  } else if (selection.kind === 'span') {
    const span = findSpan(run, selection.spanId);
    body = span ? <SpanPanel run={run} span={span} result={result} /> : null;
  } else {
    body = <SectionPanel run={run} sectionId={selection.sectionId} result={result} />;
  }
  return <aside className="inspector">{body}</aside>;
}

// ---------------------------------------------------------------------------
// Run + project
// ---------------------------------------------------------------------------

function RunPanel({ run, result }: { run: Run; result: RunResult }) {
  const editRun = useEditRun();
  const select = useEditor((s) => s.select);
  const { fmt } = useFormatter();
  const seg = run.wall[0]!;
  return (
    <>
      <Section title="Wall run">
        <Field label="Name" tip="A name for this wall run.">
          <TextInput value={run.name} onCommit={(name) => editRun((r) => void (r.name = name || r.name))} />
        </Field>
        <Field label="Wall length" tip="Wall length, inside corner to inside corner (or end to end).">
          <LengthInput value={seg.length} min={inches(6)} onCommit={(t) => editRun((r) => setWallLength(r, t))} ariaLabel="Wall length" />
        </Field>
        <Field label="Ceiling height" tip="Floor-to-ceiling height along this wall.">
          <LengthInput value={seg.ceilingHeight} min={inches(12)} onCommit={(t) => editRun((r) => setCeilingHeight(r, t))} ariaLabel="Ceiling height" />
        </Field>
        {(['left', 'right'] as const).map((side) => (
          <Field key={side} label={side === 'left' ? 'Left end' : 'Right end'}>
            <Segmented
              value={run.ends[side]}
              options={[
                ['wall', 'Wall'],
                ['open', 'Finished'],
              ]}
              onChange={(c) => editRun((r) => setEndCondition(r, side, c))}
            />
          </Field>
        ))}
      </Section>
      <Section
        title="Tiers"
        actions={
          <button onClick={() => editRun((r) => void addTier(r, null, 'above'))} title="Add a tier at the top">
            + Tier
          </button>
        }
      >
        <ul className="list">
          {[...run.tiers].reverse().map((t) => {
            const tl = result.tiers.find((x) => x.tierId === t.id);
            return (
              <li key={t.id}>
                <button className="link" onClick={() => select({ kind: 'tier', runId: run.id, tierId: t.id })}>
                  {t.name}
                </button>
                <span className="muted">
                  {t.kind === 'space' ? 'space' : `${t.items.filter((i) => i.kind === 'box').length} boxes`}
                  {tl ? ` · ${fmt(tl.height)}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
      <AddSpanSection run={run} />
      <SettingsSection scope={{ kind: 'run', runId: run.id }} />
      <ProjectPanel />
    </>
  );
}

function ProjectPanel() {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const { fmt } = useFormatter();
  return (
    <>
      <Section title="Project">
        <Field label="Name" tip="A name for this project; also the export file name.">
          <TextInput value={project.name} onCommit={(name) => edit((d) => void (d.name = name || d.name))} />
        </Field>
        <Field label="Units" tip="Unit system for this project. All sizes snap to its grid; the other system can be shown approximately." hint={`Snaps to ${fmt(project.units.grid)}`}>
          <Segmented
            value={project.units.system}
            options={[
              ['imperial', 'Imperial'],
              ['metric', 'Metric'],
            ]}
            onChange={(system) => {
              if (system === project.units.system) return;
              edit((d) => {
                d.units = { system, grid: DEFAULT_GRID[system] };
              });
            }}
          />
        </Field>
      </Section>
      <MaterialsSection />
      <StylesSection />
      <SettingsSection scope={{ kind: 'project' }} title="Construction (project defaults)" />
    </>
  );
}

/** Named styles: reusable bundles of construction settings, applied per run, tier or box. */
function StylesSection() {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const [editing, setEditing] = useState<Id | null>(null);
  const open = project.styles.find((st) => st.id === editing);
  return (
    <>
      <Section
        title="Styles"
        actions={
          <button
            title="Add an empty named style"
            onClick={() => {
              let id: Id | undefined;
              edit((d) => void (id = addStyle(d, `Style ${d.styles.length + 1}`)));
              if (id) setEditing(id);
            }}
          >
            + Style
          </button>
        }
      >
        <p className="muted small">
          Named sets of construction settings (e.g. "Inset Shaker, dado"). Apply one from any run, tier or box's Construction section; editing a style updates everything that uses it.
        </p>
        {project.styles.length === 0 && <p className="muted small">No styles yet.</p>}
        <div className="materials">
          {project.styles.map((st) => {
            const used = styleUsage(project, st.id);
            return (
              <div key={st.id} className="style-row">
                <span title="Style name">
                  <TextInput value={st.name} ariaLabel="Style name" onCommit={(name) => edit((d) => void renameStyle(d, st.id, name))} />
                </span>
                <span className="muted small-inline" title="Runs, tiers and boxes using this style">
                  {used} use{used === 1 ? '' : 's'}
                </span>
                <button className="link" onClick={() => setEditing(editing === st.id ? null : st.id)} title="Edit this style's settings">
                  {editing === st.id ? 'Done' : 'Edit'}
                </button>
                <button
                  className="link"
                  title="Delete this style (anything using it keeps its own overrides and inherits the rest)"
                  aria-label={`Delete ${st.name}`}
                  onClick={() => {
                    edit((d) => void removeStyle(d, st.id));
                    if (editing === st.id) setEditing(null);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </Section>
      {open && <SettingsSection scope={{ kind: 'style', styleId: open.id }} title={`Style: ${open.name}`} />}
    </>
  );
}

/** Color picker that commits once, when the picker closes (not on every drag step). */
function ColorInput({ value, onCommit, ariaLabel }: { value: string; onCommit: (v: string) => void; ariaLabel: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="color"
      className="color-input"
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}

/** The project's material library: each material's thickness drives every part made from it. */
function MaterialsSection() {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  return (
    <Section
      title="Materials"
      actions={
        <button
          title="Add a sheet material"
          onClick={() =>
            edit((d) =>
              void addMaterial(d, {
                name: 'New sheet',
                kind: 'sheet',
                thickness: inches(3 / 4),
                color: '#d8b98b',
                sheet: { length: inches(96), width: inches(48), grain: 'length' },
              }),
            )
          }
        >
          + Material
        </button>
      }
    >
      <p className="muted small">Thickness comes from the material. Choose which material each part uses under Construction.</p>
      <div className="materials">
        {project.materials.map((m) => {
          const used = materialUsage(project, m.id);
          return (
            <div key={m.id} className="material-row">
              <span title="Display color in the drawings and 3D view" className="material-color">
                <ColorInput value={m.color} ariaLabel={`${m.name} color`} onCommit={(color) => edit((d) => void updateMaterial(d, m.id, { color }))} />
              </span>
              <span className="material-name" title="Material name">
                <TextInput value={m.name} ariaLabel="Material name" onCommit={(name) => edit((d) => void updateMaterial(d, m.id, { name: name || m.name }))} />
              </span>
              <span className="material-thickness" title="Actual thickness. Every part made from this material uses it.">
                <LengthInput value={m.thickness} min={inches(1 / 32)} ariaLabel={`${m.name} thickness`} onCommit={(thickness) => edit((d) => void updateMaterial(d, m.id, { thickness }))} />
              </span>
              <span title="Sheet goods are nested on sheets; lumber is cut from boards.">
              <Select
                value={m.kind}
                ariaLabel={`${m.name} kind`}
                options={[
                  ['sheet', 'Sheet'],
                  ['lumber', 'Lumber'],
                ]}
                onChange={(kind) => edit((d) => void updateMaterial(d, m.id, { kind }))}
              />
              </span>
              <button
                className="link"
                disabled={used > 0}
                title={used > 0 ? `In use (${used} assignment${used === 1 ? '' : 's'})` : 'Remove this material'}
                aria-label={`Remove ${m.name}`}
                onClick={() => edit((d) => void removeMaterial(d, m.id))}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function AddSpanSection({ run, fromTierId }: { run: Run; fromTierId?: Id }) {
  const edit = useEditor((s) => s.edit);
  const select = useEditor((s) => s.select);
  const tiers = run.tiers;
  const [kind, setKind] = useState<Span['kind']>('box');
  const [from, setFrom] = useState<Id>(fromTierId ?? tiers[0]?.id ?? '');
  const [to, setTo] = useState<Id>(tiers[tiers.length - 1]?.id ?? '');
  const [anchor, setAnchor] = useState<Span['x']['anchor']>('left');
  const [width, setWidth] = useState(inches(24));
  const fromId = tiers.some((t) => t.id === from) ? from : (tiers[0]?.id ?? '');
  const toId = tiers.some((t) => t.id === to) ? to : (tiers[tiers.length - 1]?.id ?? '');
  const options = tiers.map((t) => [t.id, t.name] as const);
  return (
    <Section title="Add tall box / gap">
      <Field label="Kind" tip="Tall box: one box spanning several tiers. Gap: space kept clear, e.g. a doorway or window.">
        <Segmented
          value={kind}
          options={[
            ['box', 'Tall box'],
            ['gap', 'Gap'],
          ]}
          onChange={setKind}
        />
      </Field>
      <Field label="From tier" tip="The lowest tier it spans.">
        <Select value={fromId} options={options} onChange={setFrom} ariaLabel="From tier" />
      </Field>
      <Field label="To tier" tip="The highest tier it spans.">
        <Select value={toId} options={options} onChange={setTo} ariaLabel="To tier" />
      </Field>
      <Field label="Position" tip="Which end of the run its position is measured from.">
        <Segmented
          value={anchor}
          options={[
            ['left', 'Left'],
            ['center', 'Center'],
            ['right', 'Right'],
          ]}
          onChange={setAnchor}
        />
      </Field>
      <Field label="Width" tip="Overall width, including its share of the face frame.">
        <LengthInput value={width} min={inches(1)} onCommit={setWidth} ariaLabel="Span width" />
      </Field>
      <button
        className="primary"
        onClick={() => {
          let id: Id | undefined;
          edit((d) => {
            id = addSpan(d, run.id, { kind, fromTierId: fromId, toTierId: toId, width, x: { anchor, offset: 0 } });
          });
          if (id) select({ kind: 'span', runId: run.id, spanId: id });
        }}
      >
        Add {kind === 'box' ? 'tall box' : 'gap'}
      </button>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Tier
// ---------------------------------------------------------------------------

function TierPanel({ run, tier, result }: { run: Run; tier: Tier; result: RunResult }) {
  const editRun = useEditRun();
  const select = useEditor((s) => s.select);
  const tl = result.tiers.find((t) => t.tierId === tier.id);
  const isBottom = run.tiers[0]?.id === tier.id;
  return (
    <>
      <Section title="Tier">
        <Field label="Name" tip="A name for this tier.">
          <TextInput value={tier.name} onCommit={(n) => editRun((r) => setTierName(r, tier.id, n || tier.name))} />
        </Field>
        <Field label="Kind" tip="Boxes: a band of cabinets. Open space: an empty band, e.g. above a counter.">
          <Segmented
            value={tier.kind}
            options={[
              ['boxes', 'Boxes'],
              ['space', 'Open space'],
            ]}
            onChange={(k) => editRun((r) => setTierKind(r, tier.id, k))}
          />
        </Field>
        <SizeSpecEditor label="Height" tip="Tier height, including any toe kick and countertop. Fixed, or flex to share the wall height with other tiers." spec={tier.height} resolved={tl?.height} onChange={(s) => editRun((r) => setTierHeight(r, tier.id, s))} />
        <Field label="Depth" tip="Carcass depth including the back panel, not counting the face frame or fronts." hint="Carcass, incl. back">
          <LengthInput value={tier.depth} min={inches(2)} onCommit={(t) => editRun((r) => setTierDepth(r, tier.id, t))} ariaLabel="Tier depth" />
        </Field>
        {isBottom && (
          <>
            <Field label="Toe kick" tip="A recessed base platform under the bottom tier, with a kick board set back from the face.">
              <input
                type="checkbox"
                checked={!!tier.toeKick}
                onChange={(e) =>
                  editRun((r) => setToeKick(r, tier.id, e.target.checked ? { height: inches(3.5), setback: inches(3) } : undefined))
                }
              />
            </Field>
            {tier.toeKick && (
              <>
                <Field label="Kick height" tip="Height of the toe kick platform; the boxes sit on top of it.">
                  <LengthInput
                    value={tier.toeKick.height}
                    onCommit={(height) => editRun((r) => setToeKick(r, tier.id, { ...tier.toeKick!, height }))}
                    ariaLabel="Toe kick height"
                  />
                </Field>
                <Field label="Kick setback" tip="How far the kick board sits back from the face of the face frame." hint="From the frame face">
                  <LengthInput
                    value={tier.toeKick.setback}
                    onCommit={(setback) => editRun((r) => setToeKick(r, tier.id, { ...tier.toeKick!, setback }))}
                    ariaLabel="Toe kick setback"
                  />
                </Field>
              </>
            )}
          </>
        )}
        {tier.kind === 'boxes' && (
          <>
            <Field label="Countertop" tip="A finished top over this tier’s boxes. It fits inside the tier height, so the boxes get shorter." hint="Inside the tier height">
              <input
                type="checkbox"
                aria-label="Countertop"
                checked={!!tier.countertop}
                onChange={(e) => editRun((r) => setCountertop(r, tier.id, e.target.checked ? { ...DEFAULT_COUNTERTOP } : undefined))}
              />
            </Field>
            {tier.countertop && (
              <>
                <Field label="Top thickness" tip="Countertop thickness. The countertop material (Construction) sets its species and color.">
                  <LengthInput
                    value={tier.countertop.thickness}
                    min={inches(1 / 4)}
                    onCommit={(thickness) => editRun((r) => setCountertop(r, tier.id, { ...tier.countertop!, thickness }))}
                    ariaLabel="Countertop thickness"
                  />
                </Field>
                <Field label="Front overhang" tip="How far the countertop projects past the face of the face frame." hint="Past the frame face">
                  <LengthInput
                    value={tier.countertop.frontOverhang}
                    min={0}
                    onCommit={(frontOverhang) => editRun((r) => setCountertop(r, tier.id, { ...tier.countertop!, frontOverhang }))}
                    ariaLabel="Countertop front overhang"
                  />
                </Field>
                <Field label="End overhang" tip="How far the countertop projects past the finished end at open ends and gaps. At walls it runs to the wall." hint="At open ends and gaps">
                  <LengthInput
                    value={tier.countertop.endOverhang}
                    min={0}
                    onCommit={(endOverhang) => editRun((r) => setCountertop(r, tier.id, { ...tier.countertop!, endOverhang }))}
                    ariaLabel="Countertop end overhang"
                  />
                </Field>
              </>
            )}
          </>
        )}
        <div className="actions">
          {tier.kind === 'boxes' && (
            <button
              onClick={() => {
                let id: Id | undefined;
                editRun((r) => (id = addBox(r, tier.id, null)));
                if (id) select({ kind: 'box', runId: run.id, boxId: id });
              }}
            >
              + Box at end
            </button>
          )}
          <button onClick={() => editRun((r) => void addTier(r, tier.id, 'above'))}>+ Tier above</button>
          <button onClick={() => editRun((r) => void addTier(r, tier.id, 'below'))}>+ Tier below</button>
          <button
            className="danger"
            disabled={run.tiers.length <= 1}
            onClick={() => {
              editRun((r) => removeTier(r, tier.id));
              select({ kind: 'run', runId: run.id });
            }}
          >
            Delete tier
          </button>
        </div>
      </Section>
      <AddSpanSection run={run} fromTierId={tier.id} />
      <SettingsSection scope={{ kind: 'tier', runId: run.id, tierId: tier.id }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Box / span
// ---------------------------------------------------------------------------

function CarcassReadout({ result, id }: { result: RunResult; id: Id }) {
  const { fmt } = useFormatter();
  const b = result.boxes.find((x) => x.id === id);
  if (!b) return null;
  return (
    <Field label="Carcass" tip="Outside size of this box’s carcass (without face frame or fronts).">
      <span className="readout">
        {fmt(b.carcass.width)} W × {fmt(b.carcass.height)} H × {fmt(b.carcass.depth)} D
      </span>
    </Field>
  );
}

function FaceSummary({ run, ownerId, root }: { run: Run; ownerId: Id; root: Opening | Split }) {
  const select = useEditor((s) => s.select);
  return (
    <Field label="Face" tip="What fills the face: open, doors, drawers, or a split into several openings. Click to edit.">
      <button className="link" onClick={() => select({ kind: 'section', runId: run.id, ownerId, sectionId: root.id })}>
        {root.kind === 'opening'
          ? `${frontLabel(root.front)}${root.adjustableShelves ? `, ${root.adjustableShelves} shelves` : ''}`
          : `${root.children.length} ${root.direction}`}
      </button>
    </Field>
  );
}

function BoxPanel({ run, boxId, result }: { run: Run; boxId: Id; result: RunResult }) {
  const editRun = useEditRun();
  const select = useEditor((s) => s.select);
  const hit = findBox(run, boxId);
  if (!hit) return null;
  const { box, tier } = hit;
  const resolved = result.tiers.find((t) => t.tierId === tier.id)?.items.find((i) => i.id === box.id)?.width;
  const index = tier.items.filter((i) => i.kind === 'box').findIndex((b) => b.id === box.id);
  return (
    <>
      <Section title={box.name || `Box ${index + 1} · ${tier.name}`}>
        <Field label="Name" tip="A name for this box (optional).">
          <TextInput value={box.name ?? ''} onCommit={(n) => editRun((r) => setBoxName(r, box.id, n))} />
        </Field>
        <SizeSpecEditor label="Width" tip="Box width. Fixed, or flex to share the tier's width with other flex boxes." spec={box.width} resolved={resolved} onChange={(s) => editRun((r) => setBoxWidth(r, box.id, s))} />
        <CarcassReadout result={result} id={box.id} />
        <FaceSummary run={run} ownerId={box.id} root={box.content} />
        {box.content.kind === 'opening' && <OpeningControls run={run} ownerId={box.id} opening={box.content} />}
        <div className="actions">
          <button
            onClick={() => {
              let id: Id | undefined;
              editRun((r) => (id = addBox(r, tier.id, box.id, 'left')));
              if (id) select({ kind: 'box', runId: run.id, boxId: id });
            }}
          >
            + Box left
          </button>
          <button
            onClick={() => {
              let id: Id | undefined;
              editRun((r) => (id = addBox(r, tier.id, box.id, 'right')));
              if (id) select({ kind: 'box', runId: run.id, boxId: id });
            }}
          >
            + Box right
          </button>
          <button
            className="danger"
            onClick={() => {
              editRun((r) => removeBox(r, box.id));
              select({ kind: 'tier', runId: run.id, tierId: tier.id });
            }}
          >
            Delete box
          </button>
        </div>
      </Section>
      <SettingsSection scope={{ kind: 'box', runId: run.id, boxId: box.id }} />
    </>
  );
}

function SpanPanel({ run, span, result }: { run: Run; span: Span; result: RunResult }) {
  const edit = useEditor((s) => s.edit);
  const select = useEditor((s) => s.select);
  const tierOptions = run.tiers.map((t) => [t.id, t.name] as const);
  const bottomDepth = findTier(run, span.tiers.from)?.depth ?? 0;
  const geom = (patch: Parameters<typeof setSpanGeometry>[3]) => edit((d) => void setSpanGeometry(d, run.id, span.id, patch));
  return (
    <>
      <Section title={span.name || (span.kind === 'box' ? 'Tall box' : 'Gap')}>
        <Field label="Name" tip="A name for this tall box or gap, e.g. “door”.">
          <TextInput
            value={span.name ?? ''}
            onCommit={(n) =>
              edit((d) => {
                const s = d.runs.find((r) => r.id === run.id)?.spans.find((x) => x.id === span.id);
                if (s) s.name = n || undefined;
              })
            }
          />
        </Field>
        <Field label="Kind" tip="Tall box: one box spanning several tiers. Gap: space kept clear, e.g. a doorway or window.">
          <Segmented
            value={span.kind}
            options={[
              ['box', 'Tall box'],
              ['gap', 'Gap'],
            ]}
            onChange={(k) =>
              edit((d) => {
                const s = d.runs.find((r) => r.id === run.id)?.spans.find((x) => x.id === span.id);
                if (s) s.kind = k;
              })
            }
          />
        </Field>
        <Field label="From tier" tip="The lowest tier it spans.">
          <Select value={span.tiers.from} options={tierOptions} onChange={(id) => edit((d) => void setSpanTiers(d, run.id, span.id, id, span.tiers.to))} ariaLabel="From tier" />
        </Field>
        <Field label="To tier" tip="The highest tier it spans.">
          <Select value={span.tiers.to} options={tierOptions} onChange={(id) => edit((d) => void setSpanTiers(d, run.id, span.id, span.tiers.from, id))} ariaLabel="To tier" />
        </Field>
        <Field label="Anchor" tip="Which end of the run its position is measured from (or the center).">
          <Segmented
            value={span.x.anchor}
            options={[
              ['left', 'Left'],
              ['center', 'Center'],
              ['right', 'Right'],
            ]}
            onChange={(anchor) => geom({ x: { ...span.x, anchor } })}
          />
        </Field>
        <Field label="Offset" tip="Distance from the anchor end (or from the center)." hint={span.x.anchor === 'center' ? 'From center' : `From the ${span.x.anchor} end`}>
          <LengthInput value={span.x.offset} min={-inches(10000)} onCommit={(offset) => geom({ x: { ...span.x, offset } })} ariaLabel="Span offset" />
        </Field>
        <Field label="Width" tip="Overall width.">
          <LengthInput value={span.width} min={inches(1)} onCommit={(width) => geom({ width })} ariaLabel="Span width" />
        </Field>
        {span.kind === 'box' && (
          <Field label="Depth" tip="Carcass depth. Leave it to follow the bottom tier it spans." hint={span.depth === undefined ? 'From bottom tier' : undefined}>
            <LengthInput value={span.depth ?? bottomDepth} min={inches(2)} onCommit={(depth) => geom({ depth })} ariaLabel="Span depth" />
          </Field>
        )}
        {span.kind === 'box' && <CarcassReadout result={result} id={span.id} />}
        {span.kind === 'box' && <FaceSummary run={run} ownerId={span.id} root={span.content} />}
        {span.kind === 'box' && span.content.kind === 'opening' && <OpeningControls run={run} ownerId={span.id} opening={span.content} />}
        <div className="actions">
          <button
            className="danger"
            onClick={() => {
              edit((d) => {
                const r = d.runs.find((x) => x.id === run.id);
                if (r) removeSpan(r, span.id);
              });
              select({ kind: 'run', runId: run.id });
            }}
          >
            Delete {span.kind === 'box' ? 'tall box' : 'gap'}
          </button>
        </div>
      </Section>
      {span.kind === 'box' && <SettingsSection scope={{ kind: 'span', runId: run.id, spanId: span.id }} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type FrontKey = 'none' | 'door-left' | 'door-right' | 'doorPair' | 'drawer';
const FRONT_OPTIONS: readonly (readonly [FrontKey, string])[] = [
  ['none', 'Open (no front)'],
  ['door-left', 'Door, hinged left'],
  ['door-right', 'Door, hinged right'],
  ['doorPair', 'Door pair'],
  ['drawer', 'Drawer'],
];

function frontKey(f: Front): FrontKey {
  return f.type === 'door' ? (f.hinge === 'left' ? 'door-left' : 'door-right') : f.type;
}
function frontFromKey(k: FrontKey): Front {
  if (k === 'door-left') return { type: 'door', hinge: 'left' };
  if (k === 'door-right') return { type: 'door', hinge: 'right' };
  return { type: k };
}
function frontLabel(f: Front): string {
  return FRONT_OPTIONS.find(([k]) => k === frontKey(f))?.[1] ?? f.type;
}

function OpeningControls({ run, ownerId, opening }: { run: Run; ownerId: Id; opening: Opening }) {
  const editRun = useEditRun();
  const select = useEditor((s) => s.select);
  const [count, setCount] = useState('2');
  const split = (direction: Split['direction']) => {
    let id: Id | undefined;
    const n = Number(count);
    editRun((r) => (id = splitOpening(r, opening.id, direction, n, 'panel')));
    if (id) select({ kind: 'section', runId: run.id, ownerId, sectionId: id });
  };
  return (
    <>
      <Field label="Front" tip="Door, pair of doors, drawer front, or open.">
        <Select value={frontKey(opening.front)} options={FRONT_OPTIONS} onChange={(k) => editRun((r) => setFront(r, opening.id, frontFromKey(k)))} ariaLabel="Front" />
      </Field>
      <Field label="Adj. shelves" tip="Number of adjustable shelves, spaced evenly.">
        <NumberInput value={opening.adjustableShelves} min={0} max={20} integer onCommit={(n) => editRun((r) => setAdjustableShelves(r, opening.id, n))} ariaLabel="Adjustable shelves" />
      </Field>
      <Field label="Split into" tip="Divide this opening into rows (stacked) or columns (side by side).">
        <span className="pair">
          <Select
            value={count}
            options={['2', '3', '4', '5', '6'].map((n) => [n, n] as const)}
            onChange={setCount}
            ariaLabel="Split count"
          />
          <button onClick={() => split('rows')} title="Stack openings top to bottom">
            Rows
          </button>
          <button onClick={() => split('columns')} title="Side-by-side openings">
            Columns
          </button>
        </span>
      </Field>
    </>
  );
}

function SectionPanel({ run, sectionId, result }: { run: Run; sectionId: Id; result: RunResult }) {
  const editRun = useEditRun();
  const select = useEditor((s) => s.select);
  const { fmt } = useFormatter();
  const hit = findSectionInRun(run, sectionId);
  if (!hit) return null;
  const { section, parent, index, owner } = hit;
  const layout = result.boxes.find((b) => b.id === owner.id)?.sections.find((s) => s.sectionId === section.id);
  const parentRows = parent?.direction === 'rows';
  const resolved = layout ? (parentRows ? layout.rect.height : layout.rect.width) : undefined;
  const ownerLabel = 'kind' in owner && owner.kind === 'box' ? 'box' : 'tall box';

  return (
    <Section title={section.kind === 'opening' ? 'Opening' : `Split (${section.direction})`}>
      {layout && (
        <Field label="Clear opening" tip="Size of the opening inside the face frame.">
          <span className="readout">
            {fmt(layout.rect.width)} W × {fmt(layout.rect.height)} H
          </span>
        </Field>
      )}
      {parent && (
        <SizeSpecEditor
          label={parentRows ? 'Height' : 'Width'}
          spec={parent.children[index]!.size}
          resolved={resolved}
          onChange={(s) => editRun((r) => setSplitChildSize(r, parent.id, index, s))}
        />
      )}
      {section.kind === 'opening' ? (
        <OpeningControls run={run} ownerId={owner.id} opening={section} />
      ) : (
        <>
          <Field label="Dividers" tip="What separates the openings: a panel (fixed shelf or partition) with its frame member, or the frame member only.">
            <Select
              value={section.divider}
              options={[
                ['panel', section.direction === 'rows' ? 'Fixed shelf + rail' : 'Partition + stile'],
                ['frameOnly', section.direction === 'rows' ? 'Rail only' : 'Stile only'],
              ]}
              onChange={(v) => editRun((r) => setSplitDivider(r, section.id, v))}
              ariaLabel="Dividers"
            />
          </Field>
          <Field label="Children" tip="The openings in this split and their sizes.">
            <span className="readout">{section.children.length}</span>
          </Field>
        </>
      )}
      <div className="actions">
        {section.kind === 'split' && (
          <>
            <button onClick={() => editRun((r) => void addSplitChild(r, section.id))}>+ Opening</button>
            <button
              onClick={() => {
                let id: Id | undefined;
                editRun((r) => (id = unsplit(r, section.id)));
                if (id) select({ kind: 'section', runId: run.id, ownerId: owner.id, sectionId: id });
              }}
            >
              Merge (unsplit)
            </button>
          </>
        )}
        {parent && (
          <button
            className="danger"
            onClick={() => {
              editRun((r) => removeSection(r, section.id));
              select({ kind: 'section', runId: run.id, ownerId: owner.id, sectionId: parent.children.length > 2 ? parent.id : (parent.children[index === 0 ? 1 : 0]!.section.id) });
            }}
          >
            Remove
          </button>
        )}
        <button
          onClick={() =>
            select(parent ? { kind: 'section', runId: run.id, ownerId: owner.id, sectionId: parent.id } : ownerSelectionFor(run, owner.id))
          }
        >
          Select {parent ? 'parent split' : ownerLabel}
        </button>
      </div>
    </Section>
  );
}

function ownerSelectionFor(run: Run, ownerId: Id) {
  return findBox(run, ownerId)
    ? ({ kind: 'box', runId: run.id, boxId: ownerId } as const)
    : ({ kind: 'span', runId: run.id, spanId: ownerId } as const);
}
