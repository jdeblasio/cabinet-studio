/** Shared SVG pieces for drawing sheets. Paper units: 1 SVG unit = 1 pt. */
import type { Ticks } from '@cabinet-studio/engine';
import { useId } from 'react';
import { DIM, layoutChain, rowOffset, type Chain, type ChainLayout, type Side } from './dimensions';
import type { Pad, Placed, Proj } from './scale';

/** Unique, URL-safe id prefix for patterns in one SVG. */
export function useSvgId(): string {
  return `d${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Hatch patterns: `${id}-hatch` for solid lumber cut in section, `${id}-poche` for walls, floor and ceiling. */
export function Patterns({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={`${id}-hatch`} patternUnits="userSpaceOnUse" width={2.2} height={2.2} patternTransform="rotate(45)">
        <rect width={2.2} height={2.2} className="hatch-bg" />
        <line x1={0} y1={0} x2={0} y2={2.2} className="hatch-line" />
      </pattern>
      <pattern id={`${id}-poche`} patternUnits="userSpaceOnUse" width={3} height={3} patternTransform="rotate(45)">
        <line x1={0} y1={0} x2={0} y2={3} className="poche-line" />
      </pattern>
    </defs>
  );
}

export interface ChainsProps {
  chains: readonly Chain[];
  proj: Proj;
  placed: Placed;
  fmt: (t: Ticks) => string;
  /** Paper space between the view edge and its first row, per side (e.g. wall poché, marker band). */
  inset?: Partial<Pad>;
  /** Extension lines on these sides start no closer to the view than this (to stay off wall poché). */
  clear?: Partial<Pad>;
}

/** Lay out a world chain against a placed view. */
export function layoutFor(c: Chain, { proj, placed, fmt, inset = {}, clear = {} }: Omit<ChainsProps, 'chains'>): ChainLayout | null {
  const e = { top: placed.y, bottom: placed.y + placed.h, left: placed.x, right: placed.x + placed.w };
  const off = rowOffset(c.row, inset[c.side] ?? 0);
  const line = c.side === 'top' ? e.top - off : c.side === 'bottom' ? e.bottom + off : c.side === 'left' ? e.left - off : e.right + off;
  const horiz = c.side === 'top' || c.side === 'bottom';
  const cl = clear[c.side] ?? 0;
  const clamp = (from: number): number => {
    if (!cl) return from;
    if (c.side === 'top') return Math.min(from, e.top - cl);
    if (c.side === 'bottom') return Math.max(from, e.bottom + cl);
    if (c.side === 'left') return Math.min(from, e.left - cl);
    return Math.max(from, e.right + cl);
  };
  const points = c.points.map((p) => ({
    pos: horiz ? proj.x(p.at) : proj.y(p.at),
    from: clamp(horiz ? proj.y(p.from) : proj.x(p.from)),
    value: p.at,
  }));
  return layoutChain(points, c.side, line, fmt);
}

export function Chains(props: ChainsProps) {
  return (
    <g className="dims">
      {props.chains.map((c, i) => {
        const l = layoutFor(c, props);
        return l ? <ChainView key={`${c.side}-${c.row}-${i}`} c={l} /> : null;
      })}
    </g>
  );
}

const isHoriz = (s: Side) => s === 'top' || s === 'bottom';

/** One laid-out chain: dimension line, slash ticks, extension lines and labels. */
export function ChainView({ c }: { c: ChainLayout }) {
  const h = isHoriz(c.side);
  const t = DIM.tick;
  const over = 2.5;
  const gap = 1.8;
  const ascent = DIM.font * 0.72;
  const seg = (a: number, b: number, a2: number, b2: number) => (h ? { x1: a, y1: b, x2: a2, y2: b2 } : { x1: b, y1: a, x2: b2, y2: a2 });
  return (
    <g>
      {c.ext.map((e, i) => (
        <line key={`e${i}`} className="dim-ext" {...seg(e.pos, e.from, e.pos, e.to)} />
      ))}
      <line className="dim-line" {...seg(c.start - over, c.line, c.end + over, c.line)} />
      {c.ticks.map((p, i) => (
        <line key={`t${i}`} className="dim-tick" {...(h ? { x1: p - t, y1: c.line + t, x2: p + t, y2: c.line - t } : { x1: c.line - t, y1: p + t, x2: c.line + t, y2: p - t })} />
      ))}
      {c.labels.map((l, i) => {
        const across = l.lane === 0 ? c.line - gap : c.line + gap + ascent;
        const x = h ? l.pos : across;
        const y = h ? across : l.pos;
        return (
          <g key={`l${i}`}>
            {l.moved && (
              <line
                className="dim-leader"
                {...seg(l.mid, c.line, l.pos - (l.pos > l.mid ? l.width / 2 + 0.6 : -l.width / 2 - 0.6), c.line + (l.lane === 0 ? -1 : 1) * (gap + ascent / 2))}
              />
            )}
            <g transform={h ? undefined : `rotate(-90 ${x} ${y})`}>
              {/* Masks extension lines that cross the text. */}
              <rect className="dim-mask" x={x - l.width / 2 - 0.8} y={y - ascent - 0.8} width={l.width + 1.6} height={ascent + 1.6} />
              <text className="dim-text" x={x} y={y} textAnchor="middle">
                {l.text}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** A circled tag (box number or section letter). */
export function Bubble({ x, y, r = 5, text, className = '' }: { x: number; y: number; r?: number; text: string; className?: string }) {
  return (
    <g className={`bubble ${className}`}>
      <circle cx={x} cy={y} r={r} />
      <text x={x} y={y + r * 0.42} textAnchor="middle" style={{ fontSize: r * 1.15 }}>
        {text}
      </text>
    </g>
  );
}

/** Paper rect for a world rect given as its (u, v) min corner and size. */
export function paperRect(proj: Proj, u: Ticks, v: Ticks, w: Ticks, h: Ticks): { x: number; y: number; width: number; height: number } {
  const x0 = proj.x(u);
  const x1 = proj.x(u + w);
  const y0 = proj.y(v);
  const y1 = proj.y(v + h);
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}
