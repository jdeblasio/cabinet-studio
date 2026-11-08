import type { ReactNode } from 'react';
import { AREA, SHEET, type Scale } from './scale';

/** What every sheet's title block shows. */
export interface SheetMeta {
  projectName: string;
  runName: string;
  title: string;
  /** Second line under the title, e.g. which boxes a section cuts. */
  subtitle?: string;
  date: string;
  number: number;
  count: number;
  /** e.g. "inches" or "mm". */
  units: string;
}

/**
 * One landscape sheet: a frame with the drawing area (AREA, in points) and a title block.
 * Sizes come from SHEET so the SVG viewports and the printed page agree exactly.
 */
export function Sheet({ meta, scale, children }: { meta: SheetMeta; scale: Scale | null; children: ReactNode }) {
  const nts = !scale || scale.denom === 0;
  return (
    <section
      className="drawing-sheet"
      aria-label={`Sheet ${meta.number}: ${meta.title}`}
      style={{ width: `${SHEET.w}pt`, height: `${SHEET.h}pt`, padding: `${SHEET.margin}pt` }}
    >
      <div className="sheet-frame" style={{ borderWidth: `${SHEET.border}pt` }}>
        <div className="sheet-body" style={{ padding: `${SHEET.bodyPad}pt` }}>
          <div className="sheet-area" style={{ width: `${AREA.w}pt`, height: `${AREA.h}pt` }}>
            {children}
          </div>
        </div>
        <footer className="title-block" style={{ height: `${SHEET.titleH}pt` }}>
          <div className="tb-cell tb-project">
            <span className="tb-label">Project</span>
            <span className="tb-value">{meta.projectName || 'Untitled'}</span>
          </div>
          <div className="tb-cell">
            <span className="tb-label">Run</span>
            <span className="tb-value">{meta.runName}</span>
          </div>
          <div className="tb-cell tb-title">
            <span className="tb-label">Drawing</span>
            <span className="tb-value">{meta.title}</span>
            {meta.subtitle && <span className="tb-note">{meta.subtitle}</span>}
          </div>
          <div className="tb-cell">
            <span className="tb-label">Scale</span>
            <span className="tb-value">{scale?.label ?? 'Not to scale'}</span>
            <span className="tb-note">{nts ? `Dimensions in ${meta.units} govern` : `Print at 100% · dimensions in ${meta.units} govern`}</span>
          </div>
          <div className="tb-cell">
            <span className="tb-label">Date</span>
            <span className="tb-value">{meta.date}</span>
          </div>
          <div className="tb-cell tb-number">
            <span className="tb-label">Sheet</span>
            <span className="tb-value">
              {meta.number} <span className="tb-of">of {meta.count}</span>
            </span>
          </div>
        </footer>
      </div>
    </section>
  );
}

/** Full-area SVG for a sheet's drawing (1 unit = 1 pt). */
export function SheetSvg({ width = AREA.w, height = AREA.h, children, label }: { width?: number; height?: number; children: ReactNode; label: string }) {
  return (
    <svg className="drawing-svg" width={`${width}pt`} height={`${height}pt`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {children}
    </svg>
  );
}
