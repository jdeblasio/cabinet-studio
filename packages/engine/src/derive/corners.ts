/**
 * Automatic carcass corners ('auto' bottom or top joints): for each such box with raw edges
 * showing at its top or bottom, run its bottom under (and its top over) each side and the back
 * where that leaves less raw edge showing, one corner at a time. Only the box's own parts
 * change; the rest of the run stays fixed while choosing.
 */
import type { Bounds, HardwareItem, Part, SectionLayout } from '../derived';
import { inches } from '../units';
import { deriveBox, NO_CORNERS, settingsJoints, type CarcassJoints, type CornerPlan } from './box';
import type { Ctx } from './context';
import { exposureScorer } from './edges';
import type { PlacedBox, RunLayoutResult } from './layout';

const isAuto = (b: PlacedBox) => b.settings.carcass.bottomJoint === 'auto' || b.settings.carcass.topJoint === 'auto';

/**
 * Choose and apply corner joints for the 'auto' boxes. `parts`, `hardware` and the boxes'
 * `sections` are replaced in place with the chosen derivation (which reports its own issues).
 */
export function chooseCorners(
  ctx: Ctx,
  layout: RunLayoutResult,
  parts: Part[],
  hardware: HardwareItem[],
  sectionsOf: Map<string, SectionLayout[]>,
  boxPartIds: Map<string, Set<string>>,
): void {
  const silent: Ctx = { ...ctx, issue: () => {} };
  const score = exposureScorer(ctx, layout);
  for (const box of layout.boxes.filter(isAuto)) {
    const ids = boxPartIds.get(box.id) ?? new Set<string>();
    // Only parts near the box can cover its edges.
    const c = box.carcass;
    const pad = inches(2);
    const near = (b: Bounds) => b.x <= c.x + c.width + pad && b.x + b.width >= c.x - pad && b.y <= c.y + c.height + pad && b.y + b.height >= c.y - pad;
    const others = parts.filter((p) => !ids.has(p.id) && near(p.bounds));
    const base = settingsJoints(box.settings);
    const trial = (j: CarcassJoints) => {
      const own = deriveBox(silent, box, j).parts;
      return score(own, [...others, ...own]);
    };
    // As derived (standard joints): nothing showing at the top or bottom means nothing to choose.
    const own = parts.filter((p) => ids.has(p.id));
    const start = score(own, [...others, ...own]);
    const searchBottom = start.bottom > 0 && box.settings.carcass.bottomJoint === 'auto';
    const searchTop = start.top > 0 && box.settings.carcass.topJoint === 'auto';
    if (!searchBottom && !searchTop) continue;
    // Each corner on its own: run past it only if that leaves less raw edge (by more than a hair).
    const improve = (make: (p: CornerPlan) => CarcassJoints, from: number): CornerPlan => {
      let plan = NO_CORNERS;
      let best = from;
      // Repeat until nothing helps: one corner can pay off only after another (e.g. the side
      // after the back, which leaves a notch at their corner until the side follows).
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (const key of ['left', 'right', 'back'] as const) {
          if (plan[key]) continue;
          const next = { ...plan, [key]: true };
          const sc = trial(make(next)).total;
          if (sc < best - 1) {
            plan = next;
            best = sc;
            changed = true;
          }
        }
        if (!changed) break;
      }
      return plan;
    };
    const bottom = searchBottom ? improve((p) => ({ bottom: p, top: base.top }), start.total) : base.bottom;
    const top = searchTop ? improve((p) => ({ bottom, top: p }), trial({ bottom, top: base.top }).total) : base.top;

    // Re-derive with the chosen joints for real, and swap the box's parts and hardware.
    const final = deriveBox(ctx, box, { bottom, top });
    const at = parts.findIndex((p) => ids.has(p.id));
    const kept = parts.filter((p) => !ids.has(p.id));
    parts.length = 0;
    parts.push(...kept.slice(0, Math.max(0, at)), ...final.parts, ...kept.slice(Math.max(0, at)));
    const hw = hardware.filter((h) => h.ownerId !== box.id);
    hardware.length = 0;
    hardware.push(...hw, ...final.hardware);
    sectionsOf.set(box.id, final.sections);
    boxPartIds.set(box.id, new Set(final.parts.map((p) => p.id)));
  }
}
