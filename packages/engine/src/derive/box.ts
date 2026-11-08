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
 *  - A stile over a partition is as wide as a shared stile between two boxes (it covers the
 *    partition the way a shared stile covers two sides), so stiles line up across tiers.
 *    `midStileWidth` applies to stile-only dividers.
 *  - An 'open' top or bottom (settings.carcass) has no panel and no rail on that edge; the
 *    opening and interior run to the carcass edge, and fronts stop half a reveal short of it.
 *  - Frameless (32 mm / European) boxes have no face frame: the opening is the interior, fronts
 *    sit on the carcass edges (covering half of each shared shelf/partition edge), panel dividers
 *    are just the shelf or partition, and frame-only dividers vanish (fronts meet at the reveal).
 *  - An exposed bottom (box over a gap or open space) is finished flush with the bottom rail:
 *    a second bottom panel closes the recess behind the rail, or, if the rail is too narrow for
 *    two panels, the single bottom panel drops flush with the carcass bottom.
 */
import type { Part, Rect, SectionLayout } from '../derived';
import type { ConstructionSettings, Opening, Section } from '../model';
import { inches, snap, type Ticks } from '../units';
import { DEFAULT_HARDWARE, hardwareOf } from '../defaults';
import { checkShelfSag } from './checks';
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
  const frameless = s.construction === 'frameless';
  // Frameless boxes have no face frame: fronts sit right on the carcass front (zFrame + 0).
  const tf = frameless ? 0 : ctx.thickness(s.materials.faceFrame, id);
  const tfr = ctx.thickness(s.materials.fronts, id);
  const tsh = ctx.thickness(s.materials.shelves, id);
  const ff = s.faceFrame;
  const lip = frameless ? 0 : ff.lip;
  const { x, y, width: W, height: H, depth: D } = box.carcass;
  const top = y + H;
  const Ds = D - tb;
  const zFrame = D;
  const down = ctx.down;
  const openTop = s.carcass.top === 'open';
  const openBottom = s.carcass.bottom === 'open';
  const topRail = openTop || frameless ? 0 : ff.topRailWidth;
  const bottomRail = openBottom || frameless ? 0 : ff.bottomRailWidth;

  if (W <= 2 * t || H <= 2 * t || Ds <= 0) {
    ctx.issue('error', 'box-too-small', id, `Box is too small to build (${ctx.fmt(W)} × ${ctx.fmt(H)}).`);
    return { parts, sections };
  }

  // ---- Carcass ----
  const cm = s.materials.carcass;
  // Dado/rabbet joinery: captured parts are cut longer by the joint depth at each captured end.
  const jd = s.joinery === 'dado' || s.joinery === 'rabbet' ? s.joineryDepth : 0;
  const jointNote = (into: string) => (jd > 0 ? { note: `+${ctx.fmt(jd)} each end into ${into}` } : {});
  const captured = (n: Ticks) => n + 2 * jd;
  const innerW = W - 2 * t;
  const exposedRecess = !openBottom && box.bottomExposed && bottomRail > t;
  const doubledBottom = exposedRecess && bottomRail >= 2 * t;
  const floorTop = openBottom ? y : exposedRecess && !doubledBottom ? y + t : y + Math.max(bottomRail, t);
  add({ id: `${id}/side-left`, name: 'Left side', role: 'side', materialId: cm, bounds: { x, y, z: tb, width: t, height: H, depth: Ds }, grain: 'vertical', thicknessAxis: 'x', ownerId: id });
  add({ id: `${id}/side-right`, name: 'Right side', role: 'side', materialId: cm, bounds: { x: x + W - t, y, z: tb, width: t, height: H, depth: Ds }, grain: 'vertical', thicknessAxis: 'x', ownerId: id });
  if (!openTop) add({ id: `${id}/top`, name: 'Top', role: 'top', materialId: cm, bounds: { x: x + t, y: top - t, z: tb, width: innerW, height: t, depth: Ds }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: captured(down(innerW)), width: down(Ds), ...jointNote(s.joinery === 'rabbet' ? 'rabbets' : 'dados') });
  if (!openBottom) add({ id: `${id}/bottom`, name: 'Bottom', role: 'bottom', materialId: cm, bounds: { x: x + t, y: floorTop - t, z: tb, width: innerW, height: t, depth: Ds }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: captured(down(innerW)), width: down(Ds), ...jointNote('dados') });
  if (doubledBottom) add({ id: `${id}/bottom-finish`, name: 'Finished bottom', role: 'bottom', materialId: cm, bounds: { x: x + t, y, z: tb, width: innerW, height: t, depth: Ds }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: captured(down(innerW)), width: down(Ds), ...jointNote(s.joinery === 'rabbet' ? 'rabbets' : 'dados') });
  if (tb > 0) {
    add({ id: `${id}/back`, name: 'Back', role: 'back', materialId: s.materials.back, bounds: { x, y, z: 0, width: W, height: H, depth: tb }, grain: 'vertical', thicknessAxis: 'z', ownerId: id });
  }

  // ---- Box's own frame rails (stiles are derived per frame group) ----
  const fm = s.materials.faceFrame;
  const railX = x + t + lip;
  const railW = W - 2 * (t + lip);
  if (topRail > 0) {
    add({ id: `${id}/rail-top`, name: 'Top rail', role: 'rail', materialId: fm, bounds: { x: railX, y: top - topRail, z: zFrame, width: railW, height: topRail, depth: tf }, grain: 'horizontal', thicknessAxis: 'z', ownerId: id, length: down(railW) });
  }
  if (bottomRail > 0) {
    add({ id: `${id}/rail-bottom`, name: 'Bottom rail', role: 'rail', materialId: fm, bounds: { x: railX, y, z: zFrame, width: railW, height: bottomRail, depth: tf }, grain: 'horizontal', thicknessAxis: 'z', ownerId: id, length: down(railW) });
  }

  const R: Rect = frameless
    ? { x: x + t, y: floorTop, width: innerW, height: (openTop ? top : top - t) - floorTop }
    : { x: railX, y: y + bottomRail, width: railW, height: H - topRail - bottomRail };
  if (R.width <= 0 || R.height <= 0) {
    ctx.issue('error', 'box-too-small', id, 'Face frame leaves no opening; the box is too small for its rails and stiles.');
    return { parts, sections };
  }
  const I: Interior = { x0: x + t, x1: x + W - t, y0: floorTop, y1: openTop ? top : top - t };
  // How much of the box's edges each front may cover: the frame members, or the carcass edges when frameless.
  const cover: EdgeCover = frameless
    ? { left: t, right: t, top: openTop ? 0 : t, bottom: openBottom ? 0 : t }
    : { left: t + lip, right: t + lip, top: topRail, bottom: bottomRail };

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
    const member = frameless
      ? sec.divider === 'panel'
        ? rows
          ? tsh
          : t
        : 0
      : rows
        ? ff.midRailWidth
        : sec.divider === 'panel'
          ? snap(2 * (t + lip), ctx.grid)
          : ff.midStileWidth;
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
          if (!frameless) add({ id: `${sec.id}/rail-${i}`, name: 'Mid rail', role: 'rail', materialId: fm, bounds: { x: r.x, y: railY, z: zFrame, width: r.width, height: member, depth: tf }, grain: 'horizontal', thicknessAxis: 'z', ownerId: id, length: down(r.width) });
          if (sec.divider === 'panel') {
            const w = inner.x1 - inner.x0;
            add({ id: `${sec.id}/shelf-${i}`, name: 'Fixed shelf', role: 'fixedShelf', materialId: s.materials.shelves, bounds: { x: inner.x0, y: cy - tsh, z: tb, width: w, height: tsh, depth: Ds }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: captured(down(w)), width: down(Ds), ...jointNote('dados') });
            checkShelfSag(ctx, s, sec.id, 'Fixed shelf', s.materials.shelves, w, Ds, tsh);
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
          if (!frameless) add({ id: `${sec.id}/stile-${i}`, name: 'Mid stile', role: 'stile', materialId: fm, bounds: { x: sx, y: r.y, z: zFrame, width: member, height: r.height, depth: tf }, grain: 'vertical', thicknessAxis: 'z', ownerId: id, length: down(r.height) });
          const c = sx + member / 2;
          if (sec.divider === 'panel') {
            const h = inner.y1 - inner.y0;
            add({ id: `${sec.id}/partition-${i}`, name: 'Partition', role: 'partition', materialId: cm, bounds: { x: c - t / 2, y: inner.y0, z: tb, width: t, height: h, depth: Ds }, grain: 'vertical', thicknessAxis: 'x', ownerId: id, length: captured(down(h)), width: down(Ds), ...jointNote('dados') });
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

  /**
   * One door or drawer front in rect F (elevation): a slab, or a five-piece frame (two stiles, two
   * rails with stub tenons, a panel in grooves). Returns the z of the front's back face, where a
   * drawer box attaches.
   */
  const addFront = (op: Opening, base: string, name: string, isDoor: boolean, F: Rect): { backZ: Ticks } => {
    const fr = s.fronts;
    const style = isDoor ? fr.doorStyle : fr.drawerStyle;
    const fp = fr.fivePiece;
    const fivePiece = style === 'fivePiece' && F.width > 2 * fp.stileWidth + inches(1) && F.height > 2 * fp.railWidth + inches(1);
    if (style === 'fivePiece' && !fivePiece) {
      ctx.issue('info', 'front-too-small-for-five-piece', op.id, `${name} is too small for a five-piece front; it's a slab instead.`);
    }
    const thick = fivePiece ? ctx.thickness(s.materials.frontFrame, id) : tfr;
    const fz = fr.mounting === 'inset' ? zFrame + tf - thick : zFrame + tf;
    if (!fivePiece) {
      add({ id: base, name, role: isDoor ? 'door' : 'drawerFront', materialId: s.materials.fronts, bounds: { x: F.x, y: F.y, z: fz, width: F.width, height: F.height, depth: tfr }, grain: isDoor ? 'vertical' : 'horizontal', thicknessAxis: 'z', ownerId: id });
      return { backZ: fz };
    }
    const sw = fp.stileWidth;
    const rw = fp.railWidth;
    const g = fp.panelGroove;
    const fm = s.materials.frontFrame;
    const pm = s.materials.frontPanel;
    const tp = ctx.thickness(pm, id);
    const innerW = F.width - 2 * sw;
    const innerH = F.height - 2 * rw;
    const common = { materialId: fm, thicknessAxis: 'z' as const, ownerId: id };
    add({ ...common, id: `${base}-stile-left`, name: `${name} stile`, role: 'frontFrame', bounds: { x: F.x, y: F.y, z: fz, width: sw, height: F.height, depth: thick }, grain: 'vertical' });
    add({ ...common, id: `${base}-stile-right`, name: `${name} stile`, role: 'frontFrame', bounds: { x: F.x + F.width - sw, y: F.y, z: fz, width: sw, height: F.height, depth: thick }, grain: 'vertical' });
    // Rails run between the stiles; their cut length includes a stub tenon into each stile's groove.
    add({ ...common, id: `${base}-rail-top`, name: `${name} rail`, role: 'frontFrame', bounds: { x: F.x + sw, y: F.y + F.height - rw, z: fz, width: innerW, height: rw, depth: thick }, grain: 'horizontal', length: innerW + 2 * g });
    add({ ...common, id: `${base}-rail-bottom`, name: `${name} rail`, role: 'frontFrame', bounds: { x: F.x + sw, y: F.y, z: fz, width: innerW, height: rw, depth: thick }, grain: 'horizontal', length: innerW + 2 * g });
    // The panel floats in the grooves, centered in the frame's thickness; its cut size fills the grooves less the clearance.
    add({
      id: `${base}-panel`,
      name: `${name} panel`,
      role: 'frontPanel',
      materialId: pm,
      bounds: { x: F.x + sw, y: F.y + rw, z: fz + (thick - tp) / 2, width: innerW, height: innerH, depth: tp },
      grain: isDoor ? 'vertical' : 'horizontal',
      thicknessAxis: 'z',
      ownerId: id,
      ...(isDoor ? { length: down(innerH + 2 * (g - fp.panelClearance)), width: down(innerW + 2 * (g - fp.panelClearance)) } : { length: down(innerW + 2 * (g - fp.panelClearance)), width: down(innerH + 2 * (g - fp.panelClearance)) }),
    });
    return { backZ: fz };
  };

  /**
   * A drawer box on side-mount slides behind a drawer front: butt-jointed sides, front and back
   * (front and back between the sides) and a bottom captured in grooves. Width leaves slide
   * clearance on each side; depth is the longest standard slide that fits in front of the back.
   */
  const deriveDrawerBox = (op: Opening, r: Rect, inner: Interior, frontZ: Ticks): void => {
    const dr = s.drawers;
    const bm = s.materials.drawerBox;
    const btm = s.materials.drawerBottom;
    const t = ctx.thickness(bm, id);
    const tbot = ctx.thickness(btm, id);
    const groove = Math.min(inches(1 / 4), t / 2);
    const available = frontZ - tb - dr.rearClearance;
    const library = hardwareOf(ctx.project);
    const slide = library.slides.find((sl) => sl.id === s.hardware?.slide) ?? DEFAULT_HARDWARE.slides[0]!;
    const depth = [...slide.lengths].sort((a, b) => b - a).find((l) => l <= available);
    if (depth === undefined) {
      ctx.issue('warning', 'drawer-too-shallow', op.id, `No ${slide.name} slide fits: only ${ctx.fmt(Math.max(0, available))} of depth behind the front (shortest is ${ctx.fmt(Math.min(...slide.lengths))}).`);
      return;
    }
    const w = down(Math.min(r.width, inner.x1 - inner.x0) - 2 * slide.sideClearance);
    const h = down(r.height - dr.topClearance - dr.bottomClearance);
    if (w <= 2 * t + inches(1) || h < inches(2)) {
      ctx.issue('warning', 'drawer-too-small', op.id, 'The opening is too small for a drawer box.');
      return;
    }
    const x0 = r.x + (r.width - w) / 2;
    const y0 = r.y + dr.bottomClearance;
    const z0 = frontZ - depth;
    const base = `${op.id}/drawer`;
    const common = { materialId: bm, role: 'drawerBox' as const, ownerId: id };
    // Sides run the full depth: length front to back, width = box height.
    add({ ...common, id: `${base}-side-left`, name: 'Drawer side', bounds: { x: x0, y: y0, z: z0, width: t, height: h, depth }, grain: 'horizontal', thicknessAxis: 'x', length: depth, width: h });
    add({ ...common, id: `${base}-side-right`, name: 'Drawer side', bounds: { x: x0 + w - t, y: y0, z: z0, width: t, height: h, depth }, grain: 'horizontal', thicknessAxis: 'x', length: depth, width: h });
    add({ ...common, id: `${base}-box-front`, name: 'Drawer box front', bounds: { x: x0 + t, y: y0, z: frontZ - t, width: w - 2 * t, height: h, depth: t }, grain: 'horizontal', thicknessAxis: 'z' });
    add({ ...common, id: `${base}-box-back`, name: 'Drawer box back', bounds: { x: x0 + t, y: y0, z: z0, width: w - 2 * t, height: h, depth: t }, grain: 'horizontal', thicknessAxis: 'z' });
    // Bottom sits in a groove 1/2" up from the bottom edge, captured on all four sides.
    const bw = w - 2 * t + 2 * groove;
    const bd = depth - 2 * t + 2 * groove;
    add({ id: `${base}-bottom`, name: 'Drawer bottom', role: 'drawerBottom', materialId: btm, bounds: { x: x0 + t - groove, y: y0 + inches(1 / 2), z: z0 + t - groove, width: bw, height: tbot, depth: bd }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: down(bw), width: down(bd) });
  };

  const deriveOpening = (op: Opening, r: Rect, inner: Interior, edge: EdgeCover): void => {
    // ---- Fronts ----
    const fr = s.fronts;
    if (op.front.type !== 'none') {
      let F: Rect;
      if (fr.mounting === 'inset') {
        F = { x: r.x + fr.reveal, y: r.y + fr.reveal, width: r.width - 2 * fr.reveal, height: r.height - 2 * fr.reveal };
      } else if (fr.mounting === 'partialOverlay') {
        // Overlay each frame member; where there is none (open top/bottom), stop half a reveal short.
        const ext = (c: Ticks) => (c > 0 ? fr.overlay : -fr.reveal / 2);
        F = { x: r.x - ext(edge.left), y: r.y - ext(edge.bottom), width: r.width + ext(edge.left) + ext(edge.right), height: r.height + ext(edge.top) + ext(edge.bottom) };
      } else {
        // Full overlay: cover this opening's share of each frame member, leaving `reveal` between fronts.
        const l = edge.left - fr.reveal / 2;
        const rr = edge.right - fr.reveal / 2;
        const tp = edge.top - fr.reveal / 2;
        const bt = edge.bottom - fr.reveal / 2;
        F = { x: r.x - l, y: r.y - bt, width: r.width + l + rr, height: r.height + tp + bt };
      }
      const fh = down(F.height);
      const fy = F.y + (F.height - fh) / 2;
      if (F.width <= 0 || F.height <= 0) {
        ctx.issue('error', 'front-too-small', op.id, 'Opening is too small for a front.');
      } else if (op.front.type === 'door' || op.front.type === 'drawer') {
        const fw = down(F.width);
        const isDoor = op.front.type === 'door';
        const front = addFront(op, isDoor ? `${op.id}/door` : `${op.id}/drawer-front`, isDoor ? 'Door' : 'Drawer front', isDoor, { x: F.x + (F.width - fw) / 2, y: fy, width: fw, height: fh });
        if (isDoor && fw > inches(24)) {
          ctx.issue('warning', 'door-wide', op.id, `Door is ${ctx.fmt(fw)} wide; consider a pair of doors.`);
        }
        if (!isDoor) deriveDrawerBox(op, r, inner, front.backZ);
      } else {
        const dw = down((F.width - fr.pairGap) / 2);
        const slack = F.width - 2 * dw - fr.pairGap;
        const lx = F.x + slack / 2;
        addFront(op, `${op.id}/door-left`, 'Left door', true, { x: lx, y: fy, width: dw, height: fh });
        addFront(op, `${op.id}/door-right`, 'Right door', true, { x: lx + dw + fr.pairGap, y: fy, width: dw, height: fh });
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
    checkShelfSag(ctx, s, op.id, 'Adjustable shelf', s.materials.shelves, sw, sd, tsh);
    for (let k = 0; k < n; k++) {
      const sy = snap(inner.y0 + gap * (k + 1) + tsh * k, ctx.grid);
      add({ id: `${op.id}/adj-shelf-${k}`, name: 'Adjustable shelf', role: 'adjustableShelf', materialId: s.materials.shelves, bounds: { x: inner.x0 + s.shelves.sideClearance, y: sy, z: tb, width: sw, height: tsh, depth: sd }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: down(sw), width: down(sd) });
    }
  };

  layoutSection(box.content, R, I, cover);
  applyEdgeBanding(ctx, s, frameless, parts);
  return { parts, sections };
}

/**
 * Band exposed sheet-good edges: adjustable shelf fronts; slab doors and drawer fronts all round;
 * and for frameless boxes the front edges of sides, top, bottom, partitions and fixed shelves.
 * Cut sizes shrink by the banding thickness per banded edge; the banded length is recorded.
 */
function applyEdgeBanding(ctx: Ctx, s: ConstructionSettings, frameless: boolean, parts: Part[]): void {
  const eb = s.edgeBanding;
  if (!eb?.enabled) return;
  const isSheet = (id: string) => ctx.project.materials.find((m) => m.id === id)?.kind === 'sheet';
  const th = eb.thickness;
  const tag = (p: Part, what: string) => (th > 0 ? `${what} (cut ${ctx.fmt(th)} under per banded edge)` : what);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (!isSheet(p.materialId)) continue;
    const frontEdge = p.role === 'adjustableShelf' || (frameless && ['side', 'top', 'bottom', 'partition', 'fixedShelf'].includes(p.role));
    if (frontEdge) {
      // The front edge runs along the part's length.
      parts[i] = { ...p, width: p.width - th, banding: p.length, note: [p.note, tag(p, 'Band the front edge')].filter(Boolean).join('; ') };
    } else if (p.role === 'door' || p.role === 'drawerFront') {
      parts[i] = { ...p, length: p.length - 2 * th, width: p.width - 2 * th, banding: 2 * (p.length + p.width), note: [p.note, tag(p, 'Band all four edges')].filter(Boolean).join('; ') };
    }
  }
}
