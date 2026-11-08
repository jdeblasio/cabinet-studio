import { TICKS_PER_MM, formatLength, inches, isOnGrid, type BoxLayout, type Front, type Material, type RunResult, type Ticks, type UnitSystem } from '@built-in-planner/engine';
import { useMemo } from 'react';
import { chainPads, compactChains, type Chain } from './dimensions';
import { boxChains, boxView, frontLeaves } from './elevation';
import { ElevationParts } from './ElevationSheet';
import { cupChain, edgeDistance, holeSummary, holesOf, pinRowChains } from './features';
import { boxParts, groupParts, isFront, type BoxLabel } from './parts';
import { AREA, VIEW, fitViews, projection } from './scale';
import { cutPosition, extractSection, frameFace, frontFace } from './section';
import { SectionDrawing } from './SectionSheet';
import { Sheet, SheetSvg, type SheetMeta } from './Sheet';
import { Chains, Patterns, paperRect, useSvgId } from './svg';

interface Props {
  meta: SheetMeta;
  result: RunResult;
  box: BoxLayout;
  label: BoxLabel;
  materials: readonly Material[];
  fmt: (t: Ticks) => string;
  system: UnitSystem;
}

/** Share of the drawing area given to the views; the rest holds the box summary and parts table. */
const VIEWS_W = Math.round(AREA.w * 0.58);

const FRONT_NAMES: Record<Front['type'], string> = { none: 'Open', door: 'Door', doorPair: 'Door pair', drawer: 'Drawer' };

/** One box: front view with opening sizes, a side section, overall size and its parts table. */
export function BoxSheet({ meta, result, box, label, materials, fmt, system }: Props) {
  const id = useSvgId();
  const c = box.carcass;

  const layout = useMemo(() => {
    const front = boxView(result, box);
    // Hinge cups: dimension them up the right of the rightmost drilled front.
    const cupped = front.parts.filter((p) => isFront(p.role) && holesOf(p).some((h) => h.axis === 'z'));
    const cupDoor = cupped.sort((a, b) => b.bounds.x + b.bounds.width - (a.bounds.x + a.bounds.width))[0];
    const cups = cupDoor ? cupChain(cupDoor) : null;
    const frontChains = compactChains([...boxChains(box), ...(cups ? [cups] : [])]);
    const cut = { x: cutPosition(result, c.x, c.x + c.width), label: '', boxIds: [box.id] };
    const raw = extractSection(result, cut, (p) => p.ownerId === box.id);
    const side = { ...raw, boxes: raw.boxes.filter((b) => b.id === box.id), v0: c.y, v1: c.y + c.height };
    // Shelf pin rows: on the nearest drilled upright beyond the plane.
    const pinned = side.beyond.filter((p) => holesOf(p).some((h) => h.axis === 'x')).sort((a, b) => a.bounds.x - b.bounds.x)[0];
    const sideChains: Chain[] = compactChains([
      {
        side: 'bottom',
        row: 0,
        points: [0, c.z + c.depth, frameFace(result, side, box), frontFace(side, box)]
          .filter((z): z is Ticks => z !== undefined)
          .map((at) => ({ at, from: c.y })),
      },
      ...(pinned ? pinRowChains(pinned) : []),
    ]);
    const withCaption = (chains: readonly Chain[]) => {
      const pad = chainPads(chains);
      return { ...pad, bottom: pad.bottom + VIEW.caption - 8 };
    };
    const fit = fitViews(
      [
        { w: Math.max(front.u1 - front.u0, 1), h: Math.max(front.v1 - front.v0, 1), pad: withCaption(frontChains) },
        { w: Math.max(side.u1 - side.u0, 1), h: Math.max(c.height, 1), pad: withCaption(sideChains) },
      ],
      { w: VIEWS_W, h: AREA.h },
      { dir: 'row', gap: VIEW.gap + 6, system },
    );
    return { front, frontChains, side, sideChains, fit, cupDoor };
  }, [result, box, c, system]);

  const { front, frontChains, side, sideChains, fit, cupDoor } = layout;
  const [fp, sp] = fit.views as [(typeof fit.views)[number], (typeof fit.views)[number]];
  const proj = projection(fp, fit.scale.k, { u0: front.u0, v0: front.v0, v1: front.v1 }, true);
  const leaves = frontLeaves(result, box.id);
  const owned = boxParts(result, box.id);
  const groups = groupParts(owned);
  const holes = holeSummary(owned);
  const firstCup = cupDoor ? holesOf(cupDoor).find((h) => h.axis === 'z') : undefined;
  // Hardware is often specified in whole or half millimeters (35 mm cups, 32 mm rows): say so in imperial projects.
  const fmtHole = (t: Ticks) => (system === 'imperial' && t % (TICKS_PER_MM / 2) === 0 && !isOnGrid(t, inches(1 / 32)) ? `${fmt(t)} (${formatLength(t, 'metric')})` : fmt(t));
  const matName = new Map(materials.map((m) => [m.id, m.name]));
  const openings = box.sections.filter((s) => s.kind === 'opening');
  const capY = Math.max(fp.y + fp.h, sp.y + sp.h) + Math.max(chainPads(frontChains).bottom, chainPads(sideChains).bottom) + 10;
  const clip = `${id}-clip`;
  const win = paperRect(proj, front.u0, front.v0, front.u1 - front.u0, front.v1 - front.v0);

  return (
    <Sheet meta={meta} scale={fit.scale}>
      <div className="box-sheet">
        <SheetSvg width={VIEWS_W} label={`Box ${label.num} front view and section`}>
          <Patterns id={id} />
          <defs>
            <clipPath id={clip}>
              <rect {...win} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clip})`}>
            <ElevationParts parts={front.parts} leaves={leaves} proj={proj} />
            {front.parts
              .filter((p) => isFront(p.role))
              .flatMap((p) =>
                holesOf(p)
                  .filter((h) => h.axis === 'z')
                  .map((h, i) => <circle key={`${p.id}-h${i}`} className="hole hidden" cx={proj.x(h.x)} cy={proj.y(h.y)} r={proj.len(h.diameter / 2)} />),
              )}
          </g>
          {openings.map((o) => {
            const r = paperRect(proj, o.rect.x, o.rect.y, o.rect.width, o.rect.height);
            const cx = r.x + r.width / 2;
            const cy = r.y + r.height / 2;
            return (
              <g key={o.sectionId} className="opening-label">
                <text x={cx} y={cy} textAnchor="middle">
                  {fmt(o.rect.width)} × {fmt(o.rect.height)}
                </text>
                <text className="opening-kind" x={cx} y={cy + 7.5} textAnchor="middle">
                  {FRONT_NAMES[o.front?.type ?? 'none']} opening
                </text>
              </g>
            );
          })}
          <Chains chains={frontChains} proj={proj} placed={fp} fmt={fmt} />
          <text className="view-caption" x={fp.x + fp.w / 2} y={capY} textAnchor="middle">
            Front
          </text>

          <SectionDrawing patternId={id} data={side} chains={sideChains} placed={sp} k={fit.scale.k} materials={materials} fmt={fmt} holes />
          <text className="view-caption" x={sp.x + sp.w / 2} y={capY} textAnchor="middle">
            Section
          </text>
        </SheetSvg>

        <div className="box-info" style={{ width: `${AREA.w - VIEWS_W}pt` }}>
          <header className="box-head">
            <span className="box-num">{label.num}</span>
            <div>
              <div className="box-name">{label.name}</div>
              <div className="box-where">
                {label.tierName} · {fmt(c.x)} from left wall · {fmt(c.y)} above floor
              </div>
            </div>
          </header>
          <div className="box-size">
            <div>
              <span>W</span>
              {fmt(c.width)}
            </div>
            <div>
              <span>H</span>
              {fmt(c.height)}
            </div>
            <div>
              <span>D</span>
              {fmt(c.depth)}
            </div>
          </div>
          <div className="box-size-note">Carcass, outside of sides · depth includes the back, not the face frame</div>
          {holes.length > 0 && (
            <ul className="box-notes">
              {holes.map((h) => (
                <li key={h.label}>
                  <strong>{h.label}s:</strong> {h.count} × ⌀{fmtHole(h.diameter)}, {fmtHole(h.depth)} deep
                  {h.pitch !== undefined ? `, rows at ${fmtHole(h.pitch)} centers` : ''}
                  {h.label === firstCup?.label && cupDoor && firstCup ? `, centers ${fmtHole(edgeDistance(cupDoor, firstCup))} from the hinge edge` : ''}
                  {h.parts > 1 ? ` (${h.parts} parts)` : ''}
                </li>
              ))}
            </ul>
          )}
          <table className={`parts-table${groups.length > 18 ? ' dense' : ''}`}>
            <thead>
              <tr>
                <th>Part</th>
                <th className="num">Qty</th>
                <th>L × W × T</th>
                <th>Material</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td>{g.name}</td>
                  <td className="num">{g.qty}</td>
                  <td className="size">
                    {fmt(g.length)} × {fmt(g.width)} × {fmt(g.thickness)}
                  </td>
                  <td className="mat">{matName.get(g.materialId) ?? g.materialId}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{groups.reduce((s, g) => s + g.qty, 0)}</td>
                <td colSpan={2} className="muted">
                  Stiles shared with a neighbor are listed on one of the two boxes.
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Sheet>
  );
}
