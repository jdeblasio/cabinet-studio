import type { SizeSpec, Ticks } from '@built-in-planner/engine';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { fmtRatio, useFormatter } from '../../lib/units';

/** A labeled control. `tip` is a short description shown on hover. */
export function Field({ label, children, hint, tip }: { label: string; children: ReactNode; hint?: ReactNode; tip?: string }) {
  return (
    <label className="field" title={tip}>
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="insp-section">
      <header>
        <h3>{title}</h3>
        {actions && <div className="insp-section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** Text input that commits on Enter/blur and reverts on Escape. `parse` returning null marks it invalid. */
function CommitInput<T>({
  value,
  format,
  parse,
  onCommit,
  className,
  placeholder,
  ariaLabel,
}: {
  value: T;
  format: (v: T) => string;
  parse: (text: string) => T | null;
  onCommit: (v: T) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const shown = format(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  /** Set when Enter/Escape already handled the edit, so the following blur doesn't commit again. */
  const handled = useRef(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  const commit = () => {
    const v = parse(text.trim());
    if (v === null) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    setEditing(false);
    if (format(v) !== shown || v !== value) onCommit(v);
    setText(format(v));
    return true;
  };

  return (
    <input
      className={`input ${className ?? ''}${invalid ? ' invalid' : ''}`}
      value={text}
      placeholder={placeholder}
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
          setText(shown);
          setInvalid(false);
          setEditing(false);
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
        if (!commit()) {
          setText(shown);
          setInvalid(false);
          setEditing(false);
        }
      }}
    />
  );
}

export function LengthInput({
  value,
  onCommit,
  min = 0,
  ariaLabel,
}: {
  value: Ticks;
  onCommit: (t: Ticks) => void;
  min?: Ticks;
  ariaLabel?: string;
}) {
  const { fmt, parse } = useFormatter();
  return (
    <CommitInput
      value={value}
      format={(t) => fmt(t)}
      parse={(s) => {
        const t = parse(s);
        return t === null || t < min ? null : t;
      }}
      onCommit={onCommit}
      className="length"
      ariaLabel={ariaLabel}
    />
  );
}

export function OptionalLengthInput({
  value,
  onCommit,
  placeholder = 'none',
  ariaLabel,
}: {
  value: Ticks | undefined;
  onCommit: (t: Ticks | undefined) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const { fmt, parse } = useFormatter();
  return (
    <CommitInput<Ticks | undefined>
      value={value}
      format={(t) => (t === undefined ? '' : fmt(t))}
      parse={(s) => {
        if (s === '') return undefined;
        const t = parse(s);
        return t === null || t < 0 ? null : t;
      }}
      onCommit={onCommit}
      className="length"
      placeholder={placeholder}
      ariaLabel={ariaLabel}
    />
  );
}

export function NumberInput({
  value,
  onCommit,
  min = -Infinity,
  max = Infinity,
  integer = false,
  ariaLabel,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  ariaLabel?: string;
}) {
  return (
    <CommitInput
      value={value}
      format={(n) => fmtRatio(n)}
      parse={(s) => {
        const n = Number(s);
        if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) return null;
        return n;
      }}
      onCommit={onCommit}
      className="number"
      ariaLabel={ariaLabel}
    />
  );
}

export function TextInput({ value, onCommit, ariaLabel }: { value: string; onCommit: (s: string) => void; ariaLabel?: string }) {
  return <CommitInput value={value} format={(s) => s} parse={(s) => s} onCommit={onCommit} ariaLabel={ariaLabel} />;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <select className="input" value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <span className="segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          name={name}
          aria-checked={value === v}
          className={value === v ? 'on' : ''}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

/** Edit a fixed/flex size. `resolved` is the current computed size, used when switching to fixed. */
export function SizeSpecEditor({
  spec,
  resolved,
  onChange,
  label,
  tip,
}: {
  spec: SizeSpec;
  resolved?: Ticks;
  onChange: (s: SizeSpec) => void;
  label: string;
  tip?: string;
}) {
  const { fmt } = useFormatter();
  return (
    <div className="sizespec">
      <Field label={label} tip={tip ?? 'Fixed: an exact size. Flex: shares the remaining space with other flex items, in proportion to its ratio.'}>
        <Segmented
          value={spec.kind}
          options={[
            ['fixed', 'Fixed'],
            ['flex', 'Flex'],
          ]}
          onChange={(k) => {
            if (k === spec.kind) return;
            if (k === 'fixed') onChange({ kind: 'fixed', size: resolved ?? 0 });
            else onChange({ kind: 'flex', ratio: 1 });
          }}
        />
      </Field>
      {spec.kind === 'fixed' ? (
        <Field label="Size" tip="The exact size.">
          <LengthInput value={spec.size} onCommit={(size) => onChange({ kind: 'fixed', size })} ariaLabel={`${label} size`} />
        </Field>
      ) : (
        <>
          <Field label="Ratio" hint={resolved !== undefined ? `= ${fmt(resolved)}` : undefined} tip="Share of the leftover space relative to other flex items (2 gets twice as much as 1). Flex sizes round down to the grid.">
            <NumberInput value={spec.ratio} min={0.01} onCommit={(ratio) => onChange({ ...spec, ratio })} ariaLabel={`${label} ratio`} />
          </Field>
          <Field label="Min / max" tip="Optional limits on the flexible size. Leave blank for none.">
            <span className="pair">
              <OptionalLengthInput
                value={spec.min}
                ariaLabel={`${label} minimum`}
                onCommit={(min) => {
                  const next = { ...spec, min };
                  if (min === undefined) delete next.min;
                  onChange(next);
                }}
              />
              <OptionalLengthInput
                value={spec.max}
                ariaLabel={`${label} maximum`}
                onCommit={(max) => {
                  const next = { ...spec, max };
                  if (max === undefined) delete next.max;
                  onChange(next);
                }}
              />
            </span>
          </Field>
        </>
      )}
    </div>
  );
}
