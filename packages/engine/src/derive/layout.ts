/**
 * Run layout: vertical tier bands, horizontal placement of boxes (fixed + flex) around
 * spanning elements, and where the snap remainder goes (wall-end scribes).
 */
import type { Bounds, Rect, TierLayout } from '../derived';
import type { Box, ConstructionSettings, Id, Section, SettingsScope, Span } from '../model';
import { resolveSettings } from '../settings';
import { inches, snap, type Ticks } from '../units';
import type { Ctx } from './context';
import { solveLine } from './solveLine';

/** A carcass placed in run space, plus what's needed to derive its parts. */
export interface PlacedBox {
  id: Id;
  source: 'tier' | 'span';
  tierId: Id;
  carcass: Bounds;
  content: Section;
  settings: ConstructionSettings;
  /** True when nothing sits between this box and the wall at that end (its end stile scribes to the wall). */
  atLeftWall: boolean;
  atRightWall: boolean;
  /** True when part of the box's underside is visible (over a gap, an open space tier or nothing). */
  bottomExposed: boolean;
}

export interface RunLayoutResult {
  width: Ticks;
  ceilingHeight: Ticks;
  ceilingGap: Ticks;
  tiers: TierLayout[];
  boxes: PlacedBox[];
  gaps: { spanId: Id; rect: Rect }[];
  /** Bottom tier's toe kick, if any. */
  toeKick?: { tierId: Id; height: Ticks; setback: Ticks; settings: ConstructionSettings };
  /** How much longer the wall measures somewhere than the tightest length the boxes fit. */
  lengthVariance: Ticks;
}

interface SpanPlacement {
  span: Span;
  x: Ticks;
  fromIdx: number;
  toIdx: number;
}

export function layoutRun(ctx: Ctx): RunLayoutResult {
  const { run, grid } = ctx;
  const seg = run.wall[0]!;
  // Measured irregularity: boxes fit the tightest length and the lowest ceiling.
  const lengths = [seg.length, ...(seg.measuredLengths ?? [])].filter((l) => l > 0);
  const ceilings = [seg.ceilingHeight, ...(seg.measuredCeilings ?? [])].filter((h) => h > 0);
  const W = Math.min(...lengths);
  const H = Math.min(...ceilings);
  const runSettings = resolveSettings(ctx.project, [run]);

  // ---- Vertical: tier bands, remainder to the ceiling gap ----
  const vAvail = H - runSettings.ceilingScribe;
  const vSol = solveLine(vAvail, run.tiers.map((t) => t.height), grid);
  if (vSol.overflow > 0) {
    ctx.issue('error', 'tiers-overflow', run.id, `Tiers are ${ctx.fmt(vSol.overflow)} taller than the space below the ceiling scribe.`);
  }
  const tierY: Ticks[] = [];
  let yCursor = 0;
  vSol.sizes.forEach((h) => {
    tierY.push(yCursor);
    yCursor += h;
  });
  const ceilingGap = H - yCursor;

  // ---- Toe kick (bottom tier only) ----
  let toeKick: RunLayoutResult['toeKick'];
  run.tiers.forEach((tier, i) => {
    if (!tier.toeKick) return;
    if (i !== 0 || tier.kind !== 'boxes') {
      ctx.issue('warning', 'toe-kick-ignored', tier.id, `Toe kick on "${tier.name}" is ignored; only the bottom tier can have one.`);
      return;
    }
    if (tier.toeKick.height >= (vSol.sizes[0] ?? 0)) {
      ctx.issue('error', 'toe-kick-too-tall', tier.id, `Toe kick is taller than the "${tier.name}" tier.`);
      return;
    }
    if (tier.toeKick.height > 0) {
      toeKick = { tierId: tier.id, ...tier.toeKick, settings: resolveSettings(ctx.project, [run, tier]) };
    }
  });
  const kickH = (tierIdx: number) => (tierIdx === 0 && toeKick ? toeKick.height : 0);

  // ---- Countertops (inside the tier band, above the carcasses) ----
  const counterH = run.tiers.map((tier, i) => {
    const ct = tier.countertop;
    if (!ct || ct.thickness <= 0) return 0;
    if (tier.kind !== 'boxes') {
      ctx.issue('warning', 'countertop-ignored', tier.id, `Countertop on "${tier.name}" is ignored; it's an open space tier.`);
      return 0;
    }
    if (ct.thickness >= (vSol.sizes[i] ?? 0) - kickH(i)) {
      ctx.issue('error', 'countertop-too-thick', tier.id, `Countertop is thicker than the boxes in "${tier.name}" are tall.`);
      return 0;
    }
    return ct.thickness;
  });

  // ---- Spans: run-level positions ----
  const zoneL = run.ends.left === 'wall' ? runSettings.faceFrame.scribeAllowance : 0;
  const zoneR = W - (run.ends.right === 'wall' ? runSettings.faceFrame.scribeAllowance : 0);
  const spans: SpanPlacement[] = [];
  for (const span of run.spans) {
    const fromIdx = run.tiers.findIndex((t) => t.id === span.tiers.from);
    const toIdx = run.tiers.findIndex((t) => t.id === span.tiers.to);
    if (fromIdx < 0 || toIdx < 0 || toIdx < fromIdx) {
      ctx.issue('error', 'span-tiers-invalid', span.id, `"${spanName(span)}" spans an invalid tier range.`);
      continue;
    }
    const rawX =
      span.x.anchor === 'left'
        ? zoneL + span.x.offset
        : span.x.anchor === 'right'
          ? zoneR - span.x.offset - span.width
          : (zoneL + zoneR) / 2 + span.x.offset - span.width / 2;
    const x = snap(rawX, grid);
    if (x < zoneL || x + span.width > zoneR) {
      ctx.issue('error', 'span-outside', span.id, `"${spanName(span)}" extends past the end of the run.`);
    }
    spans.push({ span, x, fromIdx, toIdx });
  }

  const boxes: PlacedBox[] = [];
  const gaps: RunLayoutResult['gaps'] = [];
  const tiers: TierLayout[] = [];

  // ---- Horizontal, per tier ----
  run.tiers.forEach((tier, ti) => {
    const y = tierY[ti] ?? 0;
    const height = vSol.sizes[ti] ?? 0;
    const kick = kickH(ti);
    const layout: TierLayout = {
      tierId: tier.id,
      kind: tier.kind,
      y,
      height,
      depth: tier.depth,
      toeKick: kick,
      countertop: counterH[ti] ?? 0,
      scribe: { left: 0, right: 0 },
      items: [],
    };
    tiers.push(layout);
    if (tier.kind === 'space') {
      if (tier.items.some((it) => it.kind === 'box')) {
        ctx.issue('warning', 'space-tier-items', tier.id, `"${tier.name}" is an empty space tier; its boxes are ignored.`);
      }
      return;
    }

    const ts = resolveSettings(ctx.project, [run, tier]);
    const zl = run.ends.left === 'wall' ? ts.faceFrame.scribeAllowance : 0;
    const zr = W - (run.ends.right === 'wall' ? ts.faceFrame.scribeAllowance : 0);
    const here = spans.filter((sp) => sp.fromIdx <= ti && ti <= sp.toIdx);

    // Split the tier's boxes into regions separated by span slots.
    const regions: Box[][] = [[]];
    const slotOrder: SpanPlacement[] = [];
    for (const item of tier.items) {
      if (item.kind === 'slot') {
        const sp = here.find((s) => s.span.id === item.spanId);
        if (!sp) {
          ctx.issue('warning', 'slot-orphan', tier.id, `"${tier.name}" has a slot for an element that doesn't span it.`);
          continue;
        }
        if (slotOrder.includes(sp)) {
          ctx.issue('error', 'slot-duplicate', tier.id, `"${tier.name}" has a duplicate slot for "${spanName(sp.span)}".`);
          continue;
        }
        slotOrder.push(sp);
        regions.push([]);
      } else {
        regions[regions.length - 1]!.push(item);
      }
    }
    for (const sp of here) {
      if (slotOrder.includes(sp)) continue;
      ctx.issue('error', 'span-slot-missing', tier.id, `"${tier.name}" is missing a slot for "${spanName(sp.span)}".`);
      if (sp.span.x.anchor === 'left') {
        slotOrder.unshift(sp);
        regions.unshift([]);
      } else {
        slotOrder.push(sp);
        regions.push([]);
      }
    }
    for (let k = 1; k < slotOrder.length; k++) {
      if (slotOrder[k]!.x < slotOrder[k - 1]!.x) {
        ctx.issue('error', 'span-order', tier.id, `Items in "${tier.name}" are out of order relative to the spanning elements.`);
        break;
      }
    }

    const carcassY = y + kick;
    const carcassH = height - kick - (counterH[ti] ?? 0);
    const last = regions.length - 1;
    regions.forEach((regionBoxes, k) => {
      const a = k === 0 ? zl : slotOrder[k - 1]!.x + slotOrder[k - 1]!.span.width;
      const b = k === last ? zr : slotOrder[k]!.x;
      const width = b - a;
      if (width < 0) {
        ctx.issue('error', 'span-overlap', tier.id, `Spanning elements overlap in "${tier.name}".`);
      }
      // A full-width end stile at an open end of the region (beside a gap, at an open run end, or
      // next to a box with a different face plane) must not overhang past it: reserve its overhang.
      const leftSlot = k === 0 ? undefined : slotOrder[k - 1];
      const rightSlot = k === last ? undefined : slotOrder[k];
      const openBeside = (sp: SpanPlacement | undefined, wallEnd: boolean) =>
        sp ? sp.span.kind === 'gap' || (sp.span.depth ?? run.tiers[sp.fromIdx]!.depth) !== tier.depth : !wallEnd;
      const reserve = (bx: Box | undefined, side: 'left' | 'right', open: boolean): Ticks => {
        if (!bx || !open) return 0;
        const bs = resolveSettings(ctx.project, [run, tier, bx]);
        if (bs.construction === 'frameless' || bs.faceFrame.endStiles[side] !== 'full') return 0;
        return snap(ctx.thickness(bs.materials.carcass, bx.id) + bs.faceFrame.lip, grid, 'up');
      };
      const resL = reserve(regionBoxes[0], 'left', openBeside(leftSlot, run.ends.left === 'wall'));
      const resR = reserve(regionBoxes[regionBoxes.length - 1], 'right', openBeside(rightSlot, run.ends.right === 'wall'));
      const sol = solveLine(Math.max(0, width - resL - resR), regionBoxes.map((bx) => bx.width), grid);
      if (sol.overflow > 0) {
        ctx.issue('error', 'tier-overflow', tier.id, `Boxes in "${tier.name}" are ${ctx.fmt(sol.overflow)} wider than the available space.`);
      }
      const sizes = sol.sizes;
      const leftWall = k === 0 && run.ends.left === 'wall';
      const rightWall = k === last && run.ends.right === 'wall';
      let shift = 0;
      const rem = sol.remainder;
      if (rem > 0 && regionBoxes.length > 0) {
        if (leftWall && rightWall) shift = snap(rem / 2, grid, 'down');
        else if (leftWall) shift = rem;
        else if (!rightWall) {
          // Not adjacent to a wall: the rightmost flex box absorbs it.
          const flexIdx = regionBoxes.map((bx, i) => (bx.width.kind === 'flex' ? i : -1)).filter((i) => i >= 0);
          const idx = flexIdx[flexIdx.length - 1];
          if (idx !== undefined) sizes[idx] = (sizes[idx] ?? 0) + rem;
          else {
            ctx.issue('warning', 'region-underfill', tier.id, `${ctx.fmt(rem)} of unused space in "${tier.name}".`);
          }
        }
      } else if (rem > 0 && regionBoxes.length === 0 && !(leftWall || rightWall)) {
        ctx.issue('warning', 'region-empty', tier.id, `${ctx.fmt(rem)} of empty space between spanning elements in "${tier.name}".`);
      }

      let x = a + resL + shift;
      regionBoxes.forEach((bx, i) => {
        const w = sizes[i] ?? 0;
        boxes.push({
          id: bx.id,
          source: 'tier',
          tierId: tier.id,
          carcass: { x, y: carcassY, z: 0, width: w, height: carcassH, depth: tier.depth },
          content: bx.content,
          settings: resolveSettings(ctx.project, [run, tier, bx]),
          atLeftWall: false,
          atRightWall: false,
          bottomExposed: false,
        });
        layout.items.push({ kind: 'box', id: bx.id, x, width: w });
        x += w;
      });
      const sp = slotOrder[k];
      if (sp) layout.items.push({ kind: 'slot', id: sp.span.id, x: sp.x, width: sp.span.width });
    });

    if (layout.items.length > 0) {
      const first = layout.items[0]!;
      const lastItem = layout.items[layout.items.length - 1]!;
      layout.scribe.left = run.ends.left === 'wall' ? first.x : 0;
      layout.scribe.right = run.ends.right === 'wall' ? W - (lastItem.x + lastItem.width) : 0;
      const wide = ts.faceFrame.scribeAllowance + inches(3);
      if (layout.scribe.left > wide || layout.scribe.right > wide) {
        ctx.issue('warning', 'wide-scribe', tier.id, `End stile in "${tier.name}" is unusually wide; consider adding a box or a filler.`);
      }
    }
  });

  // ---- Span boxes and gaps ----
  for (const sp of spans) {
    const fromTier = run.tiers[sp.fromIdx]!;
    const yBottom = tierY[sp.fromIdx] ?? 0;
    const yTop = (tierY[sp.toIdx] ?? 0) + (vSol.sizes[sp.toIdx] ?? 0);
    if (sp.span.kind === 'gap') {
      gaps.push({ spanId: sp.span.id, rect: { x: sp.x, y: yBottom, width: sp.span.width, height: yTop - yBottom } });
      continue;
    }
    const kick = kickH(sp.fromIdx);
    boxes.push({
      id: sp.span.id,
      source: 'span',
      tierId: fromTier.id,
      carcass: {
        x: sp.x,
        y: yBottom + kick,
        z: 0,
        width: sp.span.width,
        height: yTop - yBottom - kick,
        depth: sp.span.depth ?? fromTier.depth,
      },
      content: sp.span.content,
      settings: resolveSettings(ctx.project, [run, sp.span as SettingsScope]),
      atLeftWall: false,
      atRightWall: false,
      bottomExposed: false,
    });
  }

  // ---- Which carcasses reach the walls (nothing between them and the wall) ----
  const obstacles: { x0: Ticks; x1: Ticks; y0: Ticks; y1: Ticks }[] = [
    ...boxes.map((b) => ({ x0: b.carcass.x, x1: b.carcass.x + b.carcass.width, y0: b.carcass.y, y1: b.carcass.y + b.carcass.height })),
    ...gaps.map((g) => ({ x0: g.rect.x, x1: g.rect.x + g.rect.width, y0: g.rect.y, y1: g.rect.y + g.rect.height })),
  ];
  for (const b of boxes) {
    const y0 = b.carcass.y;
    const y1 = y0 + b.carcass.height;
    const x0 = b.carcass.x;
    const x1 = x0 + b.carcass.width;
    const overlapsV = (o: (typeof obstacles)[number]) => o.y0 < y1 && o.y1 > y0;
    b.atLeftWall = run.ends.left === 'wall' && !obstacles.some((o) => overlapsV(o) && o.x1 <= x0 && o.x0 < x0);
    b.atRightWall = run.ends.right === 'wall' && !obstacles.some((o) => overlapsV(o) && o.x0 >= x1 && o.x1 > x1);
  }

  // ---- Which carcass bottoms are exposed: not resting on the floor, a carcass or a countertop ----
  const tierIdx = new Map(run.tiers.map((t, i) => [t.id, i]));
  const topOf = (o: PlacedBox) => o.carcass.y + o.carcass.height + (o.source === 'tier' ? (counterH[tierIdx.get(o.tierId) ?? -1] ?? 0) : 0);
  for (const b of boxes) {
    if (b.carcass.y <= kickH(0)) continue; // on the floor or the toe kick platform
    // Only the span between the sides matters; a sliver under a side isn't a visible recess.
    const t = ctx.thickness(b.settings.materials.carcass, b.id);
    const x0 = b.carcass.x + t;
    const x1 = b.carcass.x + b.carcass.width - t;
    const under = boxes
      .filter((o) => o !== b && topOf(o) === b.carcass.y && o.carcass.x < x1 && o.carcass.x + o.carcass.width > x0)
      .map((o) => [o.carcass.x, o.carcass.x + o.carcass.width] as const)
      .sort((p, q) => p[0] - q[0]);
    let covered = x0;
    for (const [u0, u1] of under) {
      if (u0 > covered) break;
      covered = Math.max(covered, u1);
    }
    b.bottomExposed = covered < x1;
  }

  // ---- Report measured irregularity ----
  const lengthVariance = Math.max(...lengths) - W;
  if (lengthVariance > 0) {
    const ends = (run.ends.left === 'wall' ? 1 : 0) + (run.ends.right === 'wall' ? 1 : 0);
    const capacity = ends * runSettings.faceFrame.scribeAllowance;
    ctx.issue(
      lengthVariance > capacity ? 'warning' : 'info',
      'wall-varies',
      run.id,
      lengthVariance > capacity
        ? `The wall's length varies by ${ctx.fmt(lengthVariance)}, more than the scribe allowance can take up (${ctx.fmt(capacity)}). Increase the scribe allowance or add a filler.`
        : `The wall's length varies by ${ctx.fmt(lengthVariance)}; boxes fit the tightest (${ctx.fmt(W)}) and the scribe stiles are cut wide enough to scribe to the rest.`,
    );
  }
  const ceilingVariance = Math.max(...ceilings) - H;
  if (ceilingVariance > 0) {
    ctx.issue('info', 'ceiling-varies', run.id, `The ceiling height varies by ${ctx.fmt(ceilingVariance)}; tiers fit the lowest point (${ctx.fmt(H)}). Cover the gap above with a scribe molding or crown.`);
  }

  return { width: W, ceilingHeight: H, ceilingGap, tiers, boxes, gaps, toeKick, lengthVariance };
}

function spanName(span: Span): string {
  return span.name ?? (span.kind === 'gap' ? 'Gap' : 'Tall box');
}

