/**
 * A horizontal divider that resizes the pane above it against the pane below. The split is the
 * upper pane's share of the two panes' combined height, remembered in this browser.
 */
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

/** Keeps the app's old name, like the project storage keys (see store/library.ts). */
const STORAGE_KEY = 'built-in-planner:design-split';
export const DEFAULT_SPLIT = 0.6;
/** Neither pane gets smaller than this (pixels) when dragging. */
const MIN_PANE = 80;
const KEY_STEP = 0.05;

export const clampSplit = (f: number) => Math.min(0.95, Math.max(0.05, f));

function readSplit(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) && v > 0 && v < 1 ? clampSplit(v) : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
  }
}

function writeSplit(f: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(f * 1000) / 1000));
  } catch {
    // Storage may be unavailable (private window); the split just isn't remembered.
  }
}

/** The upper pane's share of the split, and a setter that remembers it. */
export function useSplit(): [number, (f: number) => void] {
  const [split, setSplitState] = useState(readSplit);
  const setSplit = useCallback((f: number) => {
    const v = clampSplit(f);
    setSplitState(v);
    writeSplit(v);
  }, []);
  return [split, setSplit];
}

/**
 * The upper pane's share after dragging `dy` pixels from a starting upper height, keeping each
 * pane at least `minPane` tall (or half the total, if that's smaller).
 */
export function dragSplit(startUpper: number, total: number, dy: number, minPane = MIN_PANE): number {
  if (total <= 0) return DEFAULT_SPLIT;
  const min = Math.min(minPane, total / 2);
  const upper = Math.min(total - min, Math.max(min, startUpper + dy));
  return upper / total;
}

export function Splitter({
  upper,
  lower,
  split,
  onChange,
  label,
}: {
  upper: RefObject<HTMLElement | null>;
  lower: RefObject<HTMLElement | null>;
  split: number;
  onChange: (f: number) => void;
  label: string;
}) {
  const drag = useRef<{ y: number; upper: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !upper.current || !lower.current) return;
    const u = upper.current.getBoundingClientRect().height;
    const l = lower.current.getBoundingClientRect().height;
    drag.current = { y: e.clientY, upper: u, total: u + l };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) onChange(dragSplit(d.upper, d.total, e.clientY - d.y));
  };
  const end = () => {
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') onChange(split - KEY_STEP);
    else if (e.key === 'ArrowDown') onChange(split + KEY_STEP);
    else if (e.key === 'Home') onChange(0.05);
    else if (e.key === 'End') onChange(0.95);
    else if (e.key === 'Enter') onChange(DEFAULT_SPLIT);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className={`splitter${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={5}
      aria-valuemax={95}
      aria-valuenow={Math.round(split * 100)}
      tabIndex={0}
      title="Drag to resize; double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onChange(DEFAULT_SPLIT)}
      onKeyDown={onKeyDown}
    />
  );
}
