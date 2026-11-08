import { DEFAULT_GRID, formatLength, parseLength, snap, type Ticks, type UnitSystem } from '@cabinet-studio/engine';
import { useMemo } from 'react';
import { useEditor } from '../store/store';

export const otherSystem = (s: UnitSystem): UnitSystem => (s === 'imperial' ? 'metric' : 'imperial');

export interface Formatter {
  /** Unit system lengths are shown in (the project's, or the other one when toggled). */
  displaySystem: UnitSystem;
  projectSystem: UnitSystem;
  approximate: boolean;
  grid: Ticks;
  fmt: (t: Ticks, opts?: { showUnits?: boolean }) => string;
  /** Parse user input in the display system, snapped to the project grid. */
  parse: (text: string) => Ticks | null;
}

export function useFormatter(): Formatter {
  const system = useEditor((s) => s.project.units.system);
  const grid = useEditor((s) => s.project.units.grid);
  const showOther = useEditor((s) => s.showOtherUnits);
  return useMemo(() => {
    const displaySystem = showOther ? otherSystem(system) : system;
    const displayGrid = showOther ? DEFAULT_GRID[displaySystem] : grid;
    return {
      displaySystem,
      projectSystem: system,
      approximate: showOther,
      grid,
      fmt: (t, opts) =>
        formatLength(t, displaySystem, { grid: displayGrid, markApproximate: showOther, showUnits: opts?.showUnits ?? true }),
      parse: (text) => {
        const t = parseLength(text, displaySystem);
        return t === null ? null : snap(t, grid);
      },
    };
  }, [system, grid, showOther]);
}

export const fmtRatio = (r: number): string => String(Math.round(r * 100) / 100);
