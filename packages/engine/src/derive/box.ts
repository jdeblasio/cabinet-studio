/**
 * Per-box derivation (face-frame construction, butt joints):
 * carcass panels, the box's own frame rails, section layout, fronts and shelves.
 *
 * Conventions:
 *  - Sides run full height; top and bottom are captured between the sides.
 *  - An applied back covers the full rear of the box; sides/top/bottom are (depth − back) deep.
 *  - The frame is flush with the carcass top and bottom. The bottom panel (and each fixed shelf)
 *    is raised so its top surface is flush with the top edge of the rail below it.
 *  - Stile coverage on each box side is (side thickness + lip); with lip 0 the frame is flush inside.
 *  - Split child sizes are clear face-opening sizes.
 */
import type { Part, Rect, SectionLayout } from '../derived';
import type { Opening, Section } from '../model';
import { inches, snap, type Ticks } from '../units';
import { makePart, type Ctx } from './context';
import type { PlacedBox } from './layout';
import { solveLine } from './solveLine';

interface Interior {
  x0: Ticks;
  x1: Ticks;
  y0: Ticks;
  y1: Ticks;
}

/** Width of frame material on each edge of an opening that "belongs" to it (used for full overlay). */
interface EdgeCover {
  left: Ticks;
  right: Ticks;
  top: Ticks;
  bottom: Ticks;
}

export function deriveBox(ctx: Ctx, box: PlacedBox): { parts: Part[]; sections: SectionLayout[] } {
  const s = box.settings;
  const id = box.id;
  const parts: Part[] = [];
  const sections: SectionLayout[] = [];
  const add = (p: Parameters<typeof makePart>[0]) => parts.push(makePart(p));

  const t = ctx.thickness(s.materials.carcass, id);
  const tb = s.back === 'applied' ? ctx.thickness(s.materials.back, id) : 0;
  const tf = ctx.thickness(s.materials.faceFrame, id);
  const tfr = ctx.thickness(s.materials.fronts, id);
  const tsh = ctx.thickness(s.materials.shelves, id);
  const ff = s.faceFrame;
  const lip = ff.lip;
  const { x, y, width: W, height: H, depth: D } = box.carcass;
  const top = y + H;
  const Ds = D - tb;
  const zFrame = D;
  const down = ctx.down;

  if (W <= 2 * t || H <= 2 * t || Ds <= 0) {
    ctx.issue('error', 'box-too-small', id, `Box is too small to build (${ctx.fmt(W)} × ${ctx.fmt(H)}).`);
    return { parts, sections };
  }

  // ---- Carcass ----
  const cm = s.materials.carcass;
  const innerW = W - 2 * t;
  const floorTop = y + Math.max(ff.bottomRailWidth, t);
  add({ id: `${id}/side-left`, name: 'Left side', role: 'side', materialId: cm, bounds: { x, y, z: tb, width: t, height: H, depth: Ds }, grain: 'vertical', thicknessAxis: 'x', ownerId: id });
  add({ id: `${id}/side-right`, name: 'Right side', role: 'side', materialId: cm, bounds: { x: x + W - t, y, z: tb, width: t, height: H, depth: Ds }, grain: 'vertical', thicknessAxis: 'x', ownerId: id });
  add({ id: `${id}/top`, name: 'Top', role: 'top', materialId: cm, bounds: { x: x + t, y: top - t, z: tb, width: innerW, height: t, depth: Ds }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: down(innerW), width: down(Ds) });
  add({ id: `${id}/bottom`, name: 'Bottom', role: 'bottom', materialId: cm, bounds: { x: x + t, y: floorTop - t, z: tb, width: innerW, height: t, depth: Ds }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: down(innerW), width: down(Ds) });
  if (tb > 0) {
    add({ id: `${id}/back`, name: 'Back', role: 'back', materialId: s.materials.back, bounds: { x, y, z: 0, width: W, height: H, depth: tb }, grain: 'vertical', thicknessAxis: 'z', ownerId: id });
  }

  // ---- Box's own frame rails (stiles are derived per frame group) ----
  const fm = s.materials.faceFrame;
  const railX = x + t + lip;
  const railW = W - 2 * (t + lip);
  add({ id: `${id}/rail-top`, name: 'Top rail', role: 'rail', materialId: fm, bounds: { x: railX, y: top - ff.topRailWidth, z: zFrame, width: railW, height: ff.topRailWidth, depth: tf }, grain: 'horizontal', thicknessAxis: 'z', ownerId: id, length: down(railW) });
  add({ id: `${id}/rail-bottom`, name: 'Bottom rail', role: 'rail', materialId: fm, bounds: { x: railX, y, z: zFrame, width: railW, height: ff.bottomRailWidth, depth: tf }, grain: 'horizontal', thicknessAxis: 'z', ownerId: id, length: down(railW) });

  const R: Rect = { x: railX, y: y + ff.bottomRailWidth, width: railW, height: H - ff.topRailWidth - ff.bottomRailWidth };
  if (R.width <= 0 || R.height <= 0) {
    ctx.issue('error', 'box-too-small', id, 'Face frame leaves no opening; the box is too small for its rails and stiles.');
    return { parts, sections };
  }
  const I: Interior = { x0: x + t, x1: x + W - t, y0: floorTop, y1: top - t };
  const cover: EdgeCover = { left: t + lip, right: t + lip, top: ff.topRailWidth, bottom: ff.bottomRailWidth };

  const layoutSection = (sec: Section, r: Rect, inner: Interior, edge: EdgeCover, parentId?: string): void => {
    const entry: SectionLayout = { sectionId: sec.id, kind: sec.kind, rect: r };
    if (parentId) entry.parentId = parentId;
    if (sec.kind === 'opening') entry.front = sec.front;
    sections.push(entry);

    if (sec.kind === 'opening') {
      deriveOpening(sec, r, inner, edge);
      return;
    }
    const n = sec.children.length;
    if (n === 0) {
      ctx.issue('warning', 'split-empty', sec.id, 'A split in this box has no openings.');
      return;
    }
    const rows = sec.direction === 'rows';
    const member = rows ? ff.midRailWidth : ff.midStileWidth;
    const span = rows ? r.height : r.width;
    const sol = solveLine(span - (n - 1) * member, sec.children.map((c) => c.size), ctx.grid);
    if (sol.overflow > 0) {
      ctx.issue('error', 'split-overflow', sec.id, `Openings are ${ctx.fmt(sol.overflow)} ${rows ? 'taller' : 'wider'} than the space available.`);
    }
    const sizes = sol.sizes;
    if (sol.remainder > 0) {
      const flexIdx = sec.children.map((c, i) => (c.size.kind === 'flex' ? i : -1)).filter((i) => i >= 0);
      const idx = flexIdx[flexIdx.length - 1] ?? n - 1;
      if (flexIdx.length === 0) {
        ctx.issue('warning', 'split-underfill', sec.id, `Opening sizes don't fill the space; ${ctx.fmt(sol.remainder)} added to the ${rows ? 'bottom' : 'right'} opening.`);
      }
      sizes[idx] = (sizes[idx] ?? 0) + sol.remainder;
    }

    if (rows) {
      let cursor = r.y + r.height; // top edge of the next child
      let iy1 = inner.y1;
      sec.children.forEach((child, i) => {
        const h = sizes[i] ?? 0;
        const cy = cursor - h;
        const childR: Rect = { x: r.x, y: cy, width: r.width, height: h };
        const isLast = i === n - 1;
        let iy0 = inner.y0;
        let nextIy1 = iy1;
        if (!isLast) {
          const railY = cy - member;
          add({ id: `${sec.id}/rail-${i}`, name: 'Mid rail', role: 'rail', materialId: fm, bounds: { x: r.x, y: railY, z: zFrame, width: r.width, height: member, depth: tf }, grain: 'horizontal', thicknessAxis: 'z', ownerId: id, length: down(r.width) });
          if (sec.divider === 'panel') {
            const w = inner.x1 - inner.x0;
            add({ id: `${sec.id}/shelf-${i}`, name: 'Fixed shelf', role: 'fixedShelf', materialId: s.materials.shelves, bounds: { x: inner.x0, y: cy - tsh, z: tb, width: w, height: tsh, depth: Ds }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: down(w), width: down(Ds) });
            iy0 = cy;
            nextIy1 = cy - tsh;
          } else {
            iy0 = railY + member / 2;
            nextIy1 = iy0;
          }
        }
        const childEdge: EdgeCover = { ...edge, top: i === 0 ? edge.top : member / 2, bottom: isLast ? edge.bottom : member / 2 };
        layoutSection(child.section, childR, { x0: inner.x0, x1: inner.x1, y0: iy0, y1: iy1 }, childEdge, sec.id);
        iy1 = nextIy1;
        cursor = cy - member;
      });
    } else {
      let cursor = r.x;
      let ix0 = inner.x0;
      sec.children.forEach((child, i) => {
        const w = sizes[i] ?? 0;
        const childR: Rect = { x: cursor, y: r.y, width: w, height: r.height };
        const isLast = i === n - 1;
        let ix1 = inner.x1;
        let nextIx0 = ix0;
        if (!isLast) {
          const sx = cursor + w;
          add({ id: `${sec.id}/stile-${i}`, name: 'Mid stile', role: 'stile', materialId: fm, bounds: { x: sx, y: r.y, z: zFrame, width: member, height: r.height, depth: tf }, grain: 'vertical', thicknessAxis: 'z', ownerId: id, length: down(r.height) });
          const c = sx + member / 2;
          if (sec.divider === 'panel') {
            const h = inner.y1 - inner.y0;
            add({ id: `${sec.id}/partition-${i}`, name: 'Partition', role: 'partition', materialId: cm, bounds: { x: c - t / 2, y: inner.y0, z: tb, width: t, height: h, depth: Ds }, grain: 'vertical', thicknessAxis: 'x', ownerId: id, length: down(h), width: down(Ds) });
            ix1 = c - t / 2;
            nextIx0 = c + t / 2;
          } else {
            ix1 = c;
            nextIx0 = c;
          }
        }
        const childEdge: EdgeCover = { ...edge, left: i === 0 ? edge.left : member / 2, right: isLast ? edge.right : member / 2 };
        layoutSection(child.section, childR, { x0: ix0, x1: ix1, y0: inner.y0, y1: inner.y1 }, childEdge, sec.id);
        ix0 = nextIx0;
        cursor += w + member;
      });
    }
  };

  const deriveOpening = (op: Opening, r: Rect, inner: Interior, edge: EdgeCover): void => {
    // ---- Fronts ----
    const fr = s.fronts;
    if (op.front.type !== 'none') {
      let F: Rect;
      if (fr.mounting === 'inset') {
        F = { x: r.x + fr.reveal, y: r.y + fr.reveal, width: r.width - 2 * fr.reveal, height: r.height - 2 * fr.reveal };
      } else if (fr.mounting === 'partialOverlay') {
        F = { x: r.x - fr.overlay, y: r.y - fr.overlay, width: r.width + 2 * fr.overlay, height: r.height + 2 * fr.overlay };
      } else {
        // Full overlay: cover this opening's share of each frame member, leaving `reveal` between fronts.
        const l = edge.left - fr.reveal / 2;
        const rr = edge.right - fr.reveal / 2;
        const tp = edge.top - fr.reveal / 2;
        const bt = edge.bottom - fr.reveal / 2;
        F = { x: r.x - l, y: r.y - bt, width: r.width + l + rr, height: r.height + tp + bt };
      }
      const fz = fr.mounting === 'inset' ? zFrame + tf - tfr : zFrame + tf;
      const fh = down(F.height);
      const fy = F.y + (F.height - fh) / 2;
      const fmId = s.materials.fronts;
      if (F.width <= 0 || F.height <= 0) {
        ctx.issue('error', 'front-too-small', op.id, 'Opening is too small for a front.');
      } else if (op.front.type === 'door' || op.front.type === 'drawer') {
        const fw = down(F.width);
        const isDoor = op.front.type === 'door';
        add({
          id: `${op.id}/${isDoor ? 'door' : 'drawer-front'}`,
          name: isDoor ? 'Door' : 'Drawer front',
          role: isDoor ? 'door' : 'drawerFront',
          materialId: fmId,
          bounds: { x: F.x + (F.width - fw) / 2, y: fy, z: fz, width: fw, height: fh, depth: tfr },
          grain: isDoor ? 'vertical' : 'horizontal',
          thicknessAxis: 'z',
          ownerId: id,
        });
        if (isDoor && fw > inches(24)) {
          ctx.issue('warning', 'door-wide', op.id, `Door is ${ctx.fmt(fw)} wide; consider a pair of doors.`);
        }
      } else {
        const dw = down((F.width - fr.pairGap) / 2);
        const slack = F.width - 2 * dw - fr.pairGap;
        const lx = F.x + slack / 2;
        add({ id: `${op.id}/door-left`, name: 'Left door', role: 'door', materialId: fmId, bounds: { x: lx, y: fy, z: fz, width: dw, height: fh, depth: tfr }, grain: 'vertical', thicknessAxis: 'z', ownerId: id });
        add({ id: `${op.id}/door-right`, name: 'Right door', role: 'door', materialId: fmId, bounds: { x: lx + dw + fr.pairGap, y: fy, z: fz, width: dw, height: fh, depth: tfr }, grain: 'vertical', thicknessAxis: 'z', ownerId: id });
        if (dw > inches(24)) {
          ctx.issue('warning', 'door-wide', op.id, `Doors are ${ctx.fmt(dw)} wide each.`);
        }
      }
    }

    // ---- Adjustable shelves ----
    const n = op.adjustableShelves;
    if (n <= 0) return;
    if (op.front.type === 'drawer') {
      ctx.issue('warning', 'shelves-in-drawer', op.id, 'Adjustable shelves are ignored behind a drawer front.');
      return;
    }
    const sw = inner.x1 - inner.x0 - 2 * s.shelves.sideClearance;
    const sd = Ds - s.shelves.frontSetback;
    const space = inner.y1 - inner.y0;
    const gap = (space - n * tsh) / (n + 1);
    if (sw <= 0 || sd <= 0 || gap <= 0) {
      ctx.issue('error', 'shelves-no-room', op.id, 'Not enough room for the adjustable shelves.');
      return;
    }
    if (gap < inches(2)) {
      ctx.issue('warning', 'shelves-crowded', op.id, `Adjustable shelves are only ${ctx.fmt(gap)} apart.`);
    }
    if (sw > inches(36)) {
      ctx.issue('warning', 'shelf-span', op.id, `Adjustable shelf spans ${ctx.fmt(sw)}; 3/4" plywood may sag beyond about 36".`);
    }
    for (let k = 0; k < n; k++) {
      const sy = snap(inner.y0 + gap * (k + 1) + tsh * k, ctx.grid);
      add({ id: `${op.id}/adj-shelf-${k}`, name: 'Adjustable shelf', role: 'adjustableShelf', materialId: s.materials.shelves, bounds: { x: inner.x0 + s.shelves.sideClearance, y: sy, z: tb, width: sw, height: tsh, depth: sd }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: down(sw), width: down(sd) });
    }
  };

  layoutSection(box.content, R, I, cover);
  return { parts, sections };
}
