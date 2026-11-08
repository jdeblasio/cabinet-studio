import type { Id, Material, RunResult, Ticks } from '@cabinet-studio/engine';
import { useMemo } from 'react';
import type { Chain } from './dimensions';
import { holesOf } from './features';
import { roleClass, type BoxLabel } from './parts';
import { AREA, VIEW, placeViews, projection, type Placed, type Scale } from './scale';
import { SECTION_INSET, sectionLayout, type SectionData } from './section';
import { Sheet, SheetSvg, type SheetMeta } from './Sheet';
import { Bubble, Chains, Patterns, paperRect, useSvgId } from './svg';

interface Props {
  meta: SheetMeta;
  result: RunResult;
  sections: readonly SectionData[];
  /** Shared by every section sheet of the run. */
  scale: Scale;
  labels: Map<Id, BoxLabel>;
  materials: readonly Material[];
  fmt: (t: Ticks) => string;
}

/** Side sections through a run, side by side with a shared floor line. */
export function SectionSheet({ meta, result, sections, scale, labels, materials, fmt }: Props) {
  const id = useSvgId();
  const layout = useMemo(() => {
    const items = sections.map((d) => ({ data: d, ...sectionLayout(result, d) }));
    const placed = placeViews(
      items.map((i) => i.need),
      scale.k,
      AREA,
      'row',
      VIEW.gap,
    );
    const bottom = Math.max(0, ...items.map((i) => i.need.pad.bottom));
    return { items, placed, bottom };
  }, [result, sections, scale.k]);

  return (
    <Sheet meta={meta} scale={scale}>
      <SheetSvg label="Side sections">
        <Patterns id={id} />
        {layout.items.map((item, i) => {
          const placed = layout.placed[i]!;
          const capY = placed.y + placed.h + layout.bottom - VIEW.caption + 9;
          const cx = placed.x + placed.w / 2;
          const through = item.data.cut.boxIds.map((b) => labels.get(b)?.num).filter((n) => n !== undefined);
          return (
            <g key={item.data.cut.label}>
              <SectionDrawing patternId={id} data={item.data} chains={item.chains} placed={placed} k={scale.k} materials={materials} fmt={fmt} room />
              <Bubble x={cx - 22} y={capY - 2.5} r={6} text={item.data.cut.label} className="section-bubble" />
              <text className="view-caption" x={cx - 13} y={capY}>
                Section {item.data.cut.label}
              </text>
              <text className="view-note" x={cx} y={capY + 9} textAnchor="middle">
                {fmt(item.data.cut.x)} from left wall{through.length ? ` · box ${through.join(', ')}` : ''}
              </text>
            </g>
          );
        })}
      </SheetSvg>
    </Sheet>
  );
}

/** Material fill for a part cut in section: hatch for solid lumber, grays for sheet goods by role. */
function cutClass(role: string, material: Material | undefined): string {
  const cls = roleClass(role);
  if (material?.kind === 'lumber') return 'sec-lumber';
  if (cls === 'interior') return 'sec-interior';
  if (cls === 'front' || cls === 'panel') return 'sec-front';
  return 'sec-sheet';
}

/**
 * One section view: parts cut by the plane (filled by material), uprights just beyond in
 * outline, and its chains. `room` adds the wall, floor and ceiling.
 */
export function SectionDrawing({
  patternId,
  data,
  chains,
  placed,
  k,
  materials,
  fmt,
  room,
  holes,
}: {
  patternId: string;
  data: SectionData;
  chains: readonly Chain[];
  placed: Placed;
  k: number;
  materials: readonly Material[];
  fmt: (t: Ticks) => string;
  room?: boolean;
  /** Show drilled holes (shelf pins) on the uprights beyond the plane. */
  holes?: boolean;
}) {
  const proj = projection(placed, k, { u0: data.u0, v0: data.v0, v1: data.v1 }, true);
  const byId = new Map(materials.map((m) => [m.id, m]));
  const P = VIEW.poche;
  const floorY = proj.y(0);
  const ceilY = proj.y(data.v1);
  const x0 = proj.x(0);
  const x1 = placed.x + placed.w + 6;
  return (
    <g className="section-view">
      {room && (
        <g className="room">
          <rect className="poche" x={x0 - P} y={ceilY - P} width={P} height={floorY - ceilY + 2 * P} fill={`url(#${patternId}-poche)`} />
          <rect className="poche" x={x0} y={floorY} width={x1 - x0} height={P} fill={`url(#${patternId}-poche)`} />
          <rect className="poche" x={x0} y={ceilY - P} width={x1 - x0} height={P} fill={`url(#${patternId}-poche)`} />
          <line className="wall-face" x1={x0} x2={x0} y1={ceilY} y2={floorY} />
          <line className="floor-line" x1={x0 - P} x2={x1} y1={floorY} y2={floorY} />
          <line className="wall-face" x1={x0} x2={x1} y1={ceilY} y2={ceilY} />
        </g>
      )}
      {data.beyond.map((p) => (
        <rect key={p.id} className="sec-beyond" {...paperRect(proj, p.bounds.z, p.bounds.y, p.bounds.depth, p.bounds.height)} />
      ))}
      {data.parts.map((p) => {
        const cls = cutClass(p.role, byId.get(p.materialId));
        return (
          <rect
            key={p.id}
            className={`sec-cut ${cls}`}
            fill={cls === 'sec-lumber' ? `url(#${patternId}-hatch)` : undefined}
            {...paperRect(proj, p.bounds.z, p.bounds.y, p.bounds.depth, p.bounds.height)}
          />
        );
      })}
      {holes &&
        data.beyond.flatMap((p) =>
          holesOf(p)
            .filter((h) => h.axis === 'x')
            .map((h, i) => <circle key={`${p.id}-h${i}`} className="hole" cx={proj.x(h.z)} cy={proj.y(h.y)} r={Math.max(proj.len(h.diameter / 2), 0.7)} />),
        )}
      <Chains chains={chains} proj={proj} placed={placed} fmt={fmt} inset={room ? SECTION_INSET : {}} clear={room ? { left: P } : {}} />
    </g>
  );
}
