/** Optimizer settings: kerf, trim, grain, stock lengths, board width. */
import { DEFAULT_CUTLIST_OPTIONS, type Ticks } from '@built-in-planner/engine';
import { useEffect, useRef, useState } from 'react';
import { useFormatter } from '../../lib/units';
import { Field, LengthInput } from '../inspector/fields';
import { resetCutOptions, setCutOptions, useProjectCutOptions } from './state';

/** Comma-separated lengths; commits on Enter/blur, reverts on Escape. */
function LengthListInput({ value, onCommit, ariaLabel }: { value: readonly Ticks[]; onCommit: (v: Ticks[]) => void; ariaLabel: string }) {
  const { fmt, parse } = useFormatter();
  const shown = value.map((t) => fmt(t)).join(', ');
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const handled = useRef(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  const commit = (): boolean => {
    const items = text
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const vals = items.map((s) => parse(s));
    if (items.length === 0 || vals.some((v) => v === null || v <= 0)) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    setEditing(false);
    onCommit(vals as Ticks[]);
    return true;
  };
  const revert = () => {
    setText(shown);
    setInvalid(false);
    setEditing(false);
  };

  return (
    <input
      className={`input length${invalid ? ' invalid' : ''}`}
      value={text}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      onFocus={(e) => {
        setEditing(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (commit()) {
            handled.current = true;
            e.currentTarget.blur();
          }
        } else if (e.key === 'Escape') {
          revert();
          handled.current = true;
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
      onBlur={() => {
        if (handled.current) {
          handled.current = false;
          return;
        }
        if (!commit()) revert();
      }}
    />
  );
}

export function OptionsPanel() {
  const options = useProjectCutOptions();
  const setOptions = setCutOptions;
  const resetOptions = resetCutOptions;
  const { sheet, lumber } = options;
  const t = sheet.trim;
  const evenTrim = t.left === t.right && t.left === t.top && t.left === t.bottom;
  const isDefault = JSON.stringify(options) === JSON.stringify(DEFAULT_CUTLIST_OPTIONS);

  return (
    <div className="sl-options" aria-label="Optimizer settings">
      <h3>Sheet goods</h3>
      <Field label="Kerf" tip="Width of the saw cut">
        <LengthInput value={sheet.kerf} onCommit={(v) => setOptions({ sheet: { kerf: v } })} ariaLabel="Sheet kerf" />
      </Field>
      <Field label="Edge trim" tip="Cut off every sheet edge before laying out parts (kerf included)" hint={evenTrim ? 'Each edge' : 'Edges differ; this sets all four'}>
        <LengthInput value={t.left} onCommit={(v) => setOptions({ sheet: { trim: { left: v, right: v, top: v, bottom: v } } })} ariaLabel="Sheet edge trim" />
      </Field>
      <label className="sl-check" title="Sheets with grain: keep each part's length along the sheet length. Turn off for paint-grade work to let parts rotate.">
        <input type="checkbox" checked={sheet.respectGrain} onChange={(e) => setOptions({ sheet: { respectGrain: e.target.checked } })} />
        Follow the grain
      </label>

      <h3>Lumber</h3>
      <Field label="Kerf" tip="Width of a crosscut">
        <LengthInput value={lumber.kerf} onCommit={(v) => setOptions({ lumber: { kerf: v } })} ariaLabel="Lumber kerf" />
      </Field>
      <Field label="End trim" tip="Cut off each end of a board first (checks, snipe)" hint="Each end">
        <LengthInput value={lumber.endTrim} onCommit={(v) => setOptions({ lumber: { endTrim: v } })} ariaLabel="Lumber end trim" />
      </Field>
      <Field label="Stock lengths" tip="Board lengths you can buy, separated by commas (e.g. 8', 10', 12')">
        <LengthListInput value={lumber.stockLengths} onCommit={(v) => setOptions({ lumber: { stockLengths: v } })} ariaLabel="Stock lengths" />
      </Field>
      <Field label="Widest board" tip="Wider parts are glued up from several boards">
        <LengthInput value={lumber.maxBoardWidth} onCommit={(v) => setOptions({ lumber: { maxBoardWidth: v } })} ariaLabel="Widest board" />
      </Field>
      <Field label="Glue-up extra" tip="Added to a glue-up's width and length for jointing and trimming">
        <LengthInput value={lumber.glueUpAllowance} onCommit={(v) => setOptions({ lumber: { glueUpAllowance: v } })} ariaLabel="Glue-up allowance" />
      </Field>
      <div className="actions">
        <button onClick={resetOptions} disabled={isDefault}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
