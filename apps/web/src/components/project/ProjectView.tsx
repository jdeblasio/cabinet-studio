/**
 * The Project tab: settings that apply to the whole project (name and units, the material and
 * hardware libraries, named styles and the construction defaults every run inherits).
 */
import {
  addFinish,
  addMaterial,
  addStyle,
  finishesOf,
  finishUsage,
  removeFinish,
  updateFinish,
  DEFAULT_GRID,
  hardwareOf,
  inches,
  materialUsage,
  removeMaterial,
  removeStyle,
  renameStyle,
  styleUsage,
  updateHardware,
  updateMaterial,
  type Id,
} from '@cabinet-studio/engine';
import { useEffect, useState } from 'react';
import { useFormatter } from '../../lib/units';
import { useEditor } from '../../store/store';
import { Field, LengthInput, LengthListInput, NumberInput, Section, Segmented, Select, TextInput } from '../inspector/fields';
import { SettingsSection } from '../inspector/SettingsSection';
import './project.css';

export function ProjectView() {
  return (
    <div className="output-view project-view">
      <header className="project-head">
        <h1>Project settings</h1>
        <p className="muted">
          Defaults for the whole project. Each wall run, tier and box inherits the construction settings here and can override them (or apply a style) in its own Construction section on the
          Design tab.
        </p>
      </header>
      <div className="project-columns">
        <div className="project-column">
          <div className="project-card">
            <ProjectSection />
          </div>
          <div className="project-card">
            <MaterialsSection />
          </div>
          <div className="project-card">
            <FinishesSection />
          </div>
          <div className="project-card">
            <StylesSection />
          </div>
          <div className="project-card">
            <HardwareSection />
          </div>
        </div>
        <div className="project-column">
          <div className="project-card">
            <SettingsSection scope={{ kind: 'project' }} title="Construction defaults" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectSection() {
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
    </>
  );
}

/** The project's hardware library: slide, hinge and shelf-pin types (editable copies of the seed catalog). */
function HardwareSection() {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const lib = hardwareOf(project);
  return (
    <Section title="Hardware">
      <p className="muted small">Typical specs. Check your hardware's spec sheet and adjust; choose which to use under Construction.</p>
      <h4 className="subhead">Drawer slides</h4>
      {lib.slides.map((sl) => (
        <div key={sl.id} className="hardware-item">
          <TextInput value={sl.name} ariaLabel="Slide name" onCommit={(name) => edit((d) => void updateHardware(d, 'slides', sl.id, { name: name || sl.name }))} />
          <Field label="Side clearance" tip="Space per side between the drawer box and the cabinet side.">
            <LengthInput value={sl.sideClearance} ariaLabel={`${sl.name} side clearance`} onCommit={(sideClearance) => edit((d) => void updateHardware(d, 'slides', sl.id, { sideClearance }))} />
          </Field>
          <Field label="Lengths" tip="Available slide lengths, separated by commas. The box depth is the longest that fits.">
            <LengthListInput value={sl.lengths} ariaLabel={`${sl.name} lengths`} onCommit={(lengths) => lengths && edit((d) => void updateHardware(d, 'slides', sl.id, { lengths }))} />
          </Field>
        </div>
      ))}
      <h4 className="subhead">Hinges</h4>
      {lib.hinges.map((h) => (
        <div key={h.id} className="hardware-item">
          <TextInput value={h.name} ariaLabel="Hinge name" onCommit={(name) => edit((d) => void updateHardware(d, 'hinges', h.id, { name: name || h.name }))} />
        </div>
      ))}
      <h4 className="subhead">Shelf pins</h4>
      {lib.shelfPins.map((pin) => (
        <div key={pin.id} className="hardware-item">
          <TextInput value={pin.name} ariaLabel="Shelf pin name" onCommit={(name) => edit((d) => void updateHardware(d, 'shelfPins', pin.id, { name: name || pin.name }))} />
          <Field label="Per shelf" tip="Pins per adjustable shelf.">
            <NumberInput value={pin.perShelf} min={2} integer ariaLabel={`${pin.name} per shelf`} onCommit={(perShelf) => edit((d) => void updateHardware(d, 'shelfPins', pin.id, { perShelf }))} />
          </Field>
        </div>
      ))}
    </Section>
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

/** Paints and finishes: applied over a material where it's used (Construction › finish rows). */
function FinishesSection() {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  const finishes = finishesOf(project);
  return (
    <Section
      title="Paints and finishes"
      actions={
        <button title="Add a paint or finish" onClick={() => edit((d) => void addFinish(d, { name: `Paint ${finishesOf(d).length + 1}`, color: '#b9c4c9' }))}>
          + Paint
        </button>
      }
    >
      <p className="muted small">
        Paint a kind of part (e.g. face frames, doors) instead of making a material per color: choose a finish for each under Construction, here for the whole project or for any run,
        tier or box.
      </p>
      <div className="materials">
        {finishes.map((f) => {
          const used = finishUsage(project, f.id);
          return (
            <div key={f.id} className="finish-row">
              <span title="Display color in the drawings and 3D view" className="material-color">
                <ColorInput value={f.color} ariaLabel={`${f.name} color`} onCommit={(color) => edit((d) => void updateFinish(d, f.id, { color }))} />
              </span>
              <span className="material-name" title="Paint or finish name (shown in the cut list)">
                <TextInput value={f.name} ariaLabel="Finish name" onCommit={(name) => edit((d) => void updateFinish(d, f.id, { name: name || f.name }))} />
              </span>
              <span className="muted small-inline" title="Settings that use this finish">
                {used} use{used === 1 ? '' : 's'}
              </span>
              <button
                className="link"
                disabled={used > 0}
                title={used > 0 ? 'In use; set those parts back to Natural (or another finish) first' : 'Remove this finish'}
                aria-label={`Remove ${f.name}`}
                onClick={() => edit((d) => void removeFinish(d, f.id))}
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
