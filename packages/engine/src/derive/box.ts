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
import type { Bounds, HardwareItem, Part, PartFeature, Rect, SectionLayout } from '../derived';
import type { ConstructionSettings, Opening, Section } from '../model';
import { inches, mm, snap, type Ticks } from '../units';
import { DEFAULT_HARDWARE, hardwareOf } from '../defaults';
import { checkShelfSag, stripEI } from './checks';
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

/** Which parts a carcass panel runs past at its ends: e.g. a bottom under the left side and the back. */
export interface CornerPlan {
  left: boolean;
  right: boolean;
  back: boolean;
}

/**
 * How the box's corners are joined: whether the bottom (the panel at the carcass bottom) runs
 * under the sides and back, and whether the top runs over them. Default: neither (the sides run
 * full height and the back covers everything).
 */
export interface CarcassJoints {
  bottom: CornerPlan;
  top: CornerPlan;
}

export const NO_CORNERS: CornerPlan = { left: false, right: false, back: false };
const ALL_CORNERS: CornerPlan = { left: true, right: true, back: true };

/** The joints a box's settings ask for ('auto' corners start as standard; the run picks them). */
export function settingsJoints(s: ConstructionSettings): CarcassJoints {
  return {
    bottom: s.carcass.bottomJoint === 'under' ? ALL_CORNERS : NO_CORNERS,
    top: s.carcass.topJoint === 'over' ? ALL_CORNERS : NO_CORNERS,
  };
}

export function deriveBox(ctx: Ctx, box: PlacedBox, joints: CarcassJoints = settingsJoints(box.settings)): { parts: Part[]; sections: SectionLayout[]; hardware: HardwareItem[] } {
  const s = box.settings;
  const id = box.id;
  const parts: Part[] = [];
  const sections: SectionLayout[] = [];
  const hardware: HardwareItem[] = [];
  const add = (p: Parameters<typeof makePart>[0]) => parts.push(makePart(p));

  const t = ctx.thickness(s.materials.carcass, id);
  const tb = s.back === 'none' ? 0 : ctx.thickness(s.materials.back, id);
  // A rabbeted back sits in rabbets in the sides, top and bottom, which then run full depth.
  const rabbeted = s.back === 'rabbeted' && tb > 0;
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
    return { parts, sections, hardware };
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
  // Corner joints: only a bottom panel at the carcass bottom can run under the sides (a raised
  // bottom sits between them, above the rail).
  const baseBottom = doubledBottom ? 'bottom-finish' : !openBottom && floorTop - t === y ? 'bottom' : null;
  const bj = baseBottom ? joints.bottom : NO_CORNERS;
  const tj = openTop ? NO_CORNERS : joints.top;
  // Rabbet for a rabbeted back: up to half the panel thickness (3/8" at most).
  const rb = rabbeted ? Math.min(snap(t / 2, ctx.grid, 'down'), inches(3 / 8)) : 0;
  const rabbetNote = rabbeted ? `rabbet ${ctx.fmt(rb)} × ${ctx.fmt(tb)} along the back edge for the back` : '';
  const notes = (...n: (string | false | undefined)[]) => {
    const text = n.filter(Boolean).join('; ');
    return text ? { note: text.charAt(0).toUpperCase() + text.slice(1) } : {};
  };
  // Panels run full depth when the back is rabbeted into them, or when they run under/over it.
  const panelZ = (pastBack: boolean) => (rabbeted || pastBack ? 0 : tb);
  const sideZ = rabbeted ? 0 : tb;
  const sideD = D - sideZ;
  const jointWord = s.joinery === 'rabbet' ? 'a rabbet' : 'a dado';
  const side = (which: 'left' | 'right') => {
    const under = bj[which];
    const over = tj[which];
    const y0 = y + (under ? t : 0);
    const y1 = top - (over ? t : 0);
    const seated = (under ? 1 : 0) + (over ? 1 : 0);
    add({
      id: `${id}/side-${which}`,
      name: which === 'left' ? 'Left side' : 'Right side',
      role: 'side',
      materialId: cm,
      bounds: { x: which === 'left' ? x : x + W - t, y: y0, z: sideZ, width: t, height: y1 - y0, depth: sideD },
      grain: 'vertical',
      thicknessAxis: 'x',
      ownerId: id,
      length: y1 - y0 + seated * jd,
      width: down(sideD),
      ...notes(
        under && 'sits on the bottom',
        over && 'the top runs over it',
        jd > 0 && seated > 0 && `+${ctx.fmt(jd)} at ${seated === 2 ? 'each end' : 'that end'} into ${jointWord}`,
        rabbetNote,
      ),
    });
  };
  side('left');
  side('right');
  /** A top or bottom panel at height `py`, running past the sides and back per its corner plan. */
  const panel = (pid: string, name: string, role: 'top' | 'bottom', py: Ticks, plan: CornerPlan, into: string) => {
    const x0 = x + (plan.left ? 0 : t);
    const x1 = x + W - (plan.right ? 0 : t);
    const z0 = panelZ(plan.back);
    const captures = (plan.left ? 0 : 1) + (plan.right ? 0 : 1);
    const past = plan.left && plan.right ? 'the sides' : plan.left ? 'the left side' : plan.right ? 'the right side' : '';
    const word = role === 'bottom' ? 'under' : 'over';
    add({
      id: `${id}/${pid}`,
      name,
      role,
      materialId: cm,
      bounds: { x: x0, y: py, z: z0, width: x1 - x0, height: t, depth: D - z0 },
      grain: 'horizontal',
      thicknessAxis: 'y',
      ownerId: id,
      length: down(x1 - x0) + captures * jd,
      width: down(D - z0),
      ...notes(
        past && `runs ${word} ${past}${plan.back && !rabbeted ? ' and the back' : ''}`,
        !past && plan.back && !rabbeted && `runs ${word} the back`,
        jd > 0 && captures > 0 && `+${ctx.fmt(jd)} ${captures === 2 ? 'each end' : 'at the captured end'} into ${into}`,
        rabbetNote,
      ),
    });
  };
  if (!openTop) panel('top', 'Top', 'top', top - t, tj, s.joinery === 'rabbet' ? 'rabbets' : 'dados');
  if (!openBottom) panel('bottom', 'Bottom', 'bottom', floorTop - t, baseBottom === 'bottom' ? bj : NO_CORNERS, 'dados');
  if (doubledBottom) panel('bottom-finish', 'Finished bottom', 'bottom', y, bj, s.joinery === 'rabbet' ? 'rabbets' : 'dados');
  if (tb > 0) {
    if (rabbeted) {
      // In rabbets in the sides, the top and the (structural) bottom: its edges are hidden.
      const bx0 = x + t - rb;
      const bx1 = x + W - t + rb;
      const by0 = openBottom ? y : floorTop - rb;
      const by1 = openTop ? top : top - t + rb;
      add({ id: `${id}/back`, name: 'Back', role: 'back', materialId: s.materials.back, bounds: { x: bx0, y: by0, z: 0, width: bx1 - bx0, height: by1 - by0, depth: tb }, grain: 'vertical', thicknessAxis: 'z', ownerId: id, note: `Fits rabbets ${ctx.fmt(rb)} deep in the sides${openTop ? '' : ', top'}${openBottom ? '' : ' and bottom'}` });
    } else {
      const by0 = y + (bj.back ? t : 0);
      const by1 = top - (tj.back ? t : 0);
      add({ id: `${id}/back`, name: 'Back', role: 'back', materialId: s.materials.back, bounds: { x, y: by0, z: 0, width: W, height: by1 - by0, depth: tb }, grain: 'vertical', thicknessAxis: 'z', ownerId: id, ...notes(bj.back && 'sits on the bottom', tj.back && 'the top runs over it') });
    }
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
    return { parts, sections, hardware };
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
  const addFront = (op: Opening, base: string, name: string, isDoor: boolean, F: Rect): { backZ: Ticks; hingePart: (side: 'left' | 'right') => string } => {
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
      return { backZ: fz, hingePart: () => base };
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
    // Hinges bore into the stile on the hinge side.
    return { backZ: fz, hingePart: (side) => `${base}-stile-${side}` };
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
    // The slides, for illustration: side-mount slides fill the side clearance, centered on the box
    // side; undermount runners sit under the box in the recess below the bottom.
    const c = slide.sideClearance;
    for (const side of ['left', 'right'] as const) {
      const partId = `${base}-side-${side}`;
      let b: Bounds;
      if (slide.mount === 'under') {
        const drop = Math.min(mm(4), dr.bottomClearance);
        const rw = c + t + mm(11);
        b = { x: side === 'left' ? x0 - c + mm(1) : x0 + w - t - mm(12), y: y0 - drop, z: z0 + mm(6), width: rw, height: inches(1 / 2) - mm(1) + drop, depth: depth - mm(12) };
      } else {
        const sh = Math.min(mm(45), h);
        b = { x: side === 'left' ? x0 - c : x0 + w, y: y0 + (h - sh) / 2, z: z0, width: c, height: sh, depth: depth - mm(2) };
      }
      hardware.push({ id: `${partId}/slide`, kind: 'drawerSlide', name: `${slide.name}, ${ctx.fmt(depth)}`, typeId: slide.id, ownerId: id, partId, shapes: [{ kind: 'box', bounds: b }] });
    }
  };

  /** Interiors holding adjustable shelves (for shelf-pin holes) and doors to bore for hinges. */
  const pinZones: PinZone[] = [];
  const hingeDoors: HingeDoor[] = [];

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
        if (op.front.type === 'door') hingeDoors.push({ partId: front.hingePart(op.front.hinge), side: op.front.hinge, edgeX: op.front.hinge === 'left' ? r.x : r.x + r.width });
        if (isDoor && fw > inches(24)) {
          ctx.issue('warning', 'door-wide', op.id, `Door is ${ctx.fmt(fw)} wide; consider a pair of doors.`);
        }
        if (!isDoor) deriveDrawerBox(op, r, inner, front.backZ);
      } else {
        const dw = down((F.width - fr.pairGap) / 2);
        const slack = F.width - 2 * dw - fr.pairGap;
        const lx = F.x + slack / 2;
        const left = addFront(op, `${op.id}/door-left`, 'Left door', true, { x: lx, y: fy, width: dw, height: fh });
        const right = addFront(op, `${op.id}/door-right`, 'Right door', true, { x: lx + dw + fr.pairGap, y: fy, width: dw, height: fh });
        hingeDoors.push({ partId: left.hingePart('left'), side: 'left', edgeX: r.x }, { partId: right.hingePart('right'), side: 'right', edgeX: r.x + r.width });
        if (dw > inches(24)) {
          ctx.issue('warning', 'door-wide', op.id, `Doors are ${ctx.fmt(dw)} wide each.`);
        }
      }
    }

    // ---- Fixed shelves (the opening's spaces between them get the adjustable shelves) ----
    let bays: Interior[] = [inner];
    const nf = op.fixedShelves ?? 0;
    if (nf > 0) {
      if (op.front.type === 'drawer') ctx.issue('warning', 'shelves-in-drawer', op.id, 'Fixed shelves are ignored behind a drawer front.');
      else bays = addFixedShelves(op, r, inner, nf);
    }

    // ---- Adjustable shelves ----
    const n = op.adjustableShelves;
    if (n <= 0) return;
    if (op.front.type === 'drawer') {
      ctx.issue('warning', 'shelves-in-drawer', op.id, 'Adjustable shelves are ignored behind a drawer front.');
      return;
    }
    const sw = inner.x1 - inner.x0 - 2 * s.shelves.sideClearance;
    const nosing = s.shelves.adjustableFront === 'nosing' ? shelfNosing(op, r, inner) : null;
    const sd = nosing ? nosing.shelfDepth : Ds - s.shelves.frontSetback;
    const placed = bays.map((bay) => ({ bay, gap: (bay.y1 - bay.y0 - n * tsh) / (n + 1) }));
    if (sw <= 0 || sd <= 0 || placed.some((b) => b.gap <= 0)) {
      ctx.issue('error', 'shelves-no-room', op.id, 'Not enough room for the adjustable shelves.');
      return;
    }
    const tightest = Math.min(...placed.map((b) => b.gap));
    if (tightest < inches(2)) {
      ctx.issue('warning', 'shelves-crowded', op.id, `Adjustable shelves are only ${ctx.fmt(tightest)} apart.`);
    }
    const nosingEI = nosing ? stripEI(nosing.depth, nosing.height, ctx.project.materials.find((m) => m.id === s.materials.faceFrame)) : 0;
    checkShelfSag(ctx, s, op.id, nosing ? 'Adjustable shelf (with nosing)' : 'Adjustable shelf', s.materials.shelves, sw, sd, tsh, nosingEI);
    placed.forEach(({ bay, gap }, b) => {
      const zone: PinZone = { ...bay, shelves: [] };
      pinZones.push(zone);
      for (let k = 0; k < n; k++) {
        const sy = snap(bay.y0 + gap * (k + 1) + tsh * k, ctx.grid);
        const shelfId = bays.length === 1 ? `${op.id}/adj-shelf-${k}` : `${op.id}/adj-shelf-${b}-${k}`;
        zone.shelves.push({ id: shelfId, y: sy });
        add({ id: shelfId, name: 'Adjustable shelf', role: 'adjustableShelf', materialId: s.materials.shelves, bounds: { x: inner.x0 + s.shelves.sideClearance, y: sy, z: tb, width: sw, height: tsh, depth: sd }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: down(sw), width: down(sd), ...(nosing ? { note: 'Front edge covered by its nosing (glue and pin)' } : {}) });
        if (nosing) {
          const top = sy + tsh;
          add({
            id: `${shelfId}-nosing`,
            name: 'Shelf nosing',
            role: 'rail',
            materialId: s.materials.faceFrame,
            bounds: { x: nosing.x0, y: top - nosing.height, z: nosing.z, width: nosing.x1 - nosing.x0, height: nosing.height, depth: nosing.depth },
            grain: 'horizontal',
            thicknessAxis: 'z',
            ownerId: id,
            length: down(nosing.x1 - nosing.x0),
            note: `On the front of an adjustable shelf, top flush with it${nosing.setback > 0 ? `; ${ctx.fmt(nosing.setback)} back from the frame face` : ''}`,
          });
        }
      }
    });
  };

  /**
   * A frame-lumber nosing on adjustable shelves: as tall as a mid rail, where a fixed shelf's rail
   * would be (in the frame plane, or set back like an inset rail; always behind an inset front),
   * narrow enough to pass through the opening. Returns its placement and the shelf's depth behind it.
   */
  const shelfNosing = (op: Opening, r: Rect, inner: Interior) => {
    const depth = ctx.thickness(s.materials.faceFrame, id);
    const height = Math.max(ff.midRailWidth, tsh);
    let setback = (s.shelves.fixedEdge ?? 'flush') === 'inset' ? (s.shelves.fixedSetback ?? inches(1 / 4)) : 0;
    if (s.fronts.mounting === 'inset' && op.front.type !== 'none') {
      const frontThick = Math.max(tfr, ctx.thickness(s.materials.frontFrame, id));
      setback = Math.max(setback, frontThick + inches(1 / 16));
    }
    // The nosing's front is the frame face (the carcass front when frameless), less the setback.
    const front = zFrame + tf - setback;
    const z = front - depth;
    const clear = Math.max(s.shelves.sideClearance, inches(1 / 16));
    const x0 = (frameless ? inner.x0 : Math.max(r.x, inner.x0)) + clear;
    const x1 = (frameless ? inner.x1 : Math.min(r.x + r.width, inner.x1)) - clear;
    return { x0, x1, z, depth, height, setback, shelfDepth: Math.max(0, z - tb) };
  };

  /**
   * `nf` evenly spaced fixed shelves in an opening, dadoed into the sides (or partitions). On a
   * face frame each gets a rail over its front edge, its top flush with the shelf top: in the
   * frame ('flush') or set back from its face ('inset'); a rail always clears an inset front.
   * Frameless shelves have no rail. Returns the interior spaces between the shelves, bottom up.
   */
  const addFixedShelves = (op: Opening, r: Rect, inner: Interior, nf: number): Interior[] => {
    const sh = s.shelves;
    const member = frameless ? tsh : ff.midRailWidth;
    const bay = (r.height - nf * member) / (nf + 1);
    if (bay < inches(2)) {
      ctx.issue('error', 'shelves-no-room', op.id, `Not enough room for ${nf} fixed shelves.`);
      return [inner];
    }
    let setback = (sh.fixedEdge ?? 'flush') === 'inset' ? (sh.fixedSetback ?? inches(1 / 4)) : 0;
    if (s.fronts.mounting === 'inset' && op.front.type !== 'none') {
      // Behind an inset front: clear the thickest front this box might have.
      const frontThick = Math.max(tfr, ctx.thickness(s.materials.frontFrame, id));
      setback = Math.max(setback, frontThick + inches(1 / 16));
    }
    const w = inner.x1 - inner.x0;
    const depth = Ds - setback;
    if (depth <= 0) {
      ctx.issue('error', 'shelves-no-room', op.id, 'Fixed shelves are set back further than the box is deep.');
      return [inner];
    }
    checkShelfSag(ctx, s, op.id, 'Fixed shelf', s.materials.shelves, w, depth, tsh);
    const bays: Interior[] = [];
    let below = inner.y0;
    for (let k = 0; k < nf; k++) {
      const railY = snap(r.y + (k + 1) * bay + k * member, ctx.grid);
      const shelfTop = railY + member;
      const shelfY = shelfTop - tsh;
      if (!frameless) {
        add({
          id: `${op.id}/shelf-rail-${k}`,
          name: 'Shelf rail',
          role: 'rail',
          materialId: s.materials.faceFrame,
          bounds: { x: r.x, y: railY, z: zFrame - setback, width: r.width, height: member, depth: tf },
          grain: 'horizontal',
          thicknessAxis: 'z',
          ownerId: id,
          length: down(r.width),
          ...(setback > 0 ? { note: `Set back ${ctx.fmt(setback)} from the face frame, over the fixed shelf's front edge` } : {}),
        });
      }
      add({ id: `${op.id}/fixed-shelf-${k}`, name: 'Fixed shelf', role: 'fixedShelf', materialId: s.materials.shelves, bounds: { x: inner.x0, y: shelfY, z: tb, width: w, height: tsh, depth }, grain: 'horizontal', thicknessAxis: 'y', ownerId: id, length: captured(down(w)), width: down(depth), ...jointNote('dados') });
      bays.push({ ...inner, y0: below, y1: shelfY });
      below = shelfTop;
    }
    bays.push({ ...inner, y0: below, y1: inner.y1 });
    return bays;
  };

  layoutSection(box.content, R, I, cover);
  applyEdgeBanding(ctx, s, frameless, parts);
  addMachining(ctx, s, id, parts, hardware, pinZones, hingeDoors, zFrame - HINGE_ARM_REACH);
  return { parts, sections, hardware };
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
    // Adjustable shelves with a nosing have their front covered instead.
    const nosed = p.role === 'adjustableShelf' && s.shelves.adjustableFront === 'nosing';
    const frontEdge = (p.role === 'adjustableShelf' && !nosed) || (frameless && ['side', 'top', 'bottom', 'partition', 'fixedShelf'].includes(p.role));
    if (frontEdge) {
      // The front edge runs along the part's length.
      parts[i] = { ...p, width: p.width - th, banding: p.length, bandedEdges: ['front'], note: [p.note, tag(p, 'Band the front edge')].filter(Boolean).join('; ') };
    } else if (p.role === 'door' || p.role === 'drawerFront') {
      parts[i] = { ...p, length: p.length - 2 * th, width: p.width - 2 * th, banding: 2 * (p.length + p.width), bandedEdges: ['left', 'right', 'bottom', 'top'], note: [p.note, tag(p, 'Band all four edges')].filter(Boolean).join('; ') };
    }
  }
}

/** Shelf pin spacing (the 32 mm system) and how far the pin rows stay from the ends and edges. */
const PIN_PITCH = mm(32);
const PIN_END_MARGIN = inches(4);
const PIN_EDGE_INSET = inches(1.5);

/** An interior with adjustable shelves: where shelf pin holes go, and the shelves' bottoms. */
interface PinZone extends Interior {
  shelves: { id: string; y: Ticks }[];
}

/** A door (or the stile of a five-piece door) to bore for hinges. */
interface HingeDoor {
  partId: string;
  side: 'left' | 'right';
  /** x of the opening's edge on the hinge side, where the hinge arm runs into the box. */
  edgeX: Ticks;
}

/** How far behind the carcass front a concealed hinge's arm and plate reach (for illustration). */
const HINGE_ARM_REACH = mm(40);
/** Visible length of a shelf pin (for illustration). */
const PIN_LENGTH = mm(12);

/**
 * Machining as real geometry:
 *  - Shelf pin holes: two rows (front and back) on each face that holds adjustable shelves,
 *    on 32 mm centers, keeping clear of the opening's top and bottom.
 *  - Hinge cups (concealed hinges): along the hinge edge of each door's back face, 3" from the
 *    top and bottom with more hinges spread between on taller doors.
 * Also places the hardware itself for illustration: a pin under each shelf corner, and each
 * hinge (a concealed hinge's cup and arm, or a butt hinge's knuckle).
 */
function addMachining(
  ctx: Ctx,
  s: ConstructionSettings,
  ownerId: string,
  parts: Part[],
  hardware: HardwareItem[],
  pinZones: readonly PinZone[],
  hingeDoors: readonly HingeDoor[],
  armZ: Ticks,
): void {
  const lib = hardwareOf(ctx.project);
  const pin = lib.shelfPins.find((p) => p.id === s.hardware?.shelfPin) ?? DEFAULT_HARDWARE.shelfPins[0]!;
  const hinge = lib.hinges.find((h) => h.id === s.hardware?.hinge) ?? DEFAULT_HARDWARE.hinges[0]!;
  const addFeatures = (partId: string, features: PartFeature[]) => {
    const i = parts.findIndex((p) => p.id === partId);
    if (i < 0 || features.length === 0) return;
    const p = parts[i]!;
    parts[i] = { ...p, features: [...(p.features ?? []), ...features] };
  };

  for (const zone of pinZones) {
    const ys: Ticks[] = [];
    for (let y = zone.y0 + PIN_END_MARGIN; y <= zone.y1 - PIN_END_MARGIN; y += PIN_PITCH) ys.push(Math.round(y));
    if (ys.length === 0) continue;
    // The faces bounding the zone: a side or partition whose inner face is at zone.x0 / zone.x1.
    const faces: { part: Part; x: Ticks }[] = [];
    for (const p of parts) {
      if (p.role !== 'side' && p.role !== 'partition') continue;
      const b = p.bounds;
      const overlapsY = b.y < zone.y1 && b.y + b.height > zone.y0;
      if (!overlapsY) continue;
      if (b.x + b.width === zone.x0) faces.push({ part: p, x: zone.x0 });
      if (b.x === zone.x1) faces.push({ part: p, x: zone.x1 });
    }
    for (const { part, x } of faces) {
      const b = part.bounds;
      const zs = [b.z + PIN_EDGE_INSET, b.z + b.depth - PIN_EDGE_INSET];
      addFeatures(
        part.id,
        ys.flatMap((y) => zs.map((z): PartFeature => ({ kind: 'hole', label: 'Shelf pin', x, y, z, axis: 'x', diameter: pin.diameter, depth: inches(3 / 8) }))),
      );
      // A pin under each shelf at each row, sticking out of the face into the interior.
      const left = x === zone.x0;
      const cx = left ? x + PIN_LENGTH / 2 : x - PIN_LENGTH / 2;
      for (const shelf of zone.shelves) {
        hardware.push({
          id: `${shelf.id}/pins-${left ? 'left' : 'right'}`,
          kind: 'shelfPin',
          name: pin.name,
          typeId: pin.id,
          ownerId,
          partId: part.id,
          shapes: zs.map((z) => ({ kind: 'cylinder', x: cx, y: shelf.y - pin.diameter / 2, z, axis: 'x', diameter: pin.diameter, length: PIN_LENGTH })),
        });
      }
    }
  }

  if (hinge.kind === 'concealed') {
    const cup = hinge.cupDiameter ?? mm(35);
    for (const edge of hingeDoors) {
      const { partId, side } = edge;
      const door = parts.find((p) => p.id === partId);
      if (!door) continue;
      const b = door.bounds;
      const ys = hingeHeights(b);
      // Cup center 22.5 mm in from the door's hinge edge (on the door, not a stile's inner edge).
      const cupX = side === 'left' ? b.x + mm(22.5) : b.x + b.width - mm(22.5);
      addFeatures(
        partId,
        ys.map((y): PartFeature => ({ kind: 'hole', label: 'Hinge cup', x: cupX, y, z: b.z, axis: 'z', diameter: cup, depth: inches(1 / 2) })),
      );
      // The hinge: its cup in the door (proud of the back by 2 mm), and an arm running from the
      // cup back into the box along the opening's hinge edge, where it mounts.
      const armW = mm(16);
      const armX = side === 'left' ? edge.edgeX : edge.edgeX - armW;
      ys.forEach((y, k) => {
        hardware.push({
          id: `${partId}/hinge-${k}`,
          kind: 'hinge',
          name: hinge.name,
          typeId: hinge.id,
          ownerId,
          partId,
          shapes: [
            { kind: 'cylinder', x: cupX, y, z: b.z + mm(4.5), axis: 'z', diameter: cup, length: mm(13) },
            { kind: 'box', bounds: { x: armX, y: y - mm(8), z: armZ, width: armW, height: mm(16), depth: Math.max(mm(1), b.z - armZ) } },
          ],
        });
      });
    }
  } else if (hinge.kind === 'butt') {
    // Butt hinges: just the knuckle, at the door's hinge edge, proud of its face.
    for (const { partId, side } of hingeDoors) {
      const door = parts.find((p) => p.id === partId);
      if (!door) continue;
      const b = door.bounds;
      const d = mm(9);
      hingeHeights(b).forEach((y, k) => {
        hardware.push({
          id: `${partId}/hinge-${k}`,
          kind: 'hinge',
          name: hinge.name,
          typeId: hinge.id,
          ownerId,
          partId,
          shapes: [{ kind: 'cylinder', x: side === 'left' ? b.x : b.x + b.width, y, z: b.z + b.depth + d / 4, axis: 'y', diameter: d, length: inches(2.5) }],
        });
      });
    }
  }
}

/** Hinge centers on a door: 3" from the top and bottom, more spread between on taller doors (2 up to 40", one more per 20"). */
function hingeHeights(b: Bounds): Ticks[] {
  const h = b.height;
  const count = h <= inches(40) ? 2 : h <= inches(60) ? 3 : h <= inches(80) ? 4 : 5;
  const top = b.y + b.height - inches(3);
  const bottom = b.y + inches(3);
  return Array.from({ length: count }, (_, i) => Math.round(bottom + ((top - bottom) * i) / (count - 1)));
}
