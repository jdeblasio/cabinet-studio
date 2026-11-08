/**
 * Step-by-step build instructions, generated from the derived design and its cut report.
 *
 * Order, roughly bottom to top:
 *  1. Before you start: check the room, buy materials, gather tools.
 *  2. Cut and prepare: cut sheet goods and lumber, cut joints, drill, band edges, pre-finish.
 *  3. Each tier, bottom to top (tall boxes with the tier they stand on): the toe kick platform,
 *     each box's carcass, setting and fastening the boxes, then any face frame whose boxes are
 *     all in place, and the tier's countertop.
 *  4. Trim (crown and base molding), then doors, drawers and shelves, then finishing.
 *
 * Steps name parts by their cut list letters, so the cut list, sheet layouts and these steps
 * agree. Pure: everything comes from the project, its derived runs and the cut report.
 */
import { describeBandedEdges, type BoxLayout, type Part, type RunResult } from '../derived';
import { finishesOf } from '../defaults';
import { formatLength } from '../format';
import type { ConstructionSettings, Id, Project, Run, SettingsScope } from '../model';
import { resolveSettings } from '../settings';
import { inches, toMm, type Ticks } from '../units';
import type { CutListRow } from '../cutlist/cutlist';
import type { CutReport } from '../cutlist/index';
import { ownerLabels } from '../cutlist/parts';

/** A part (or several identical ones) used in a step. */
export interface BuildPart {
  /** Cut list row letter (A, B, …); '' when the part isn't on the cut list. */
  label: string;
  name: string;
  qty: number;
  length: Ticks;
  width: Ticks;
  thickness: Ticks;
  materialId: Id;
}

export interface BuildStep {
  id: string;
  title: string;
  /** What it's about, e.g. "Bottom 2 · 28 13/16 W × 50 H × 12 D". */
  subtitle?: string;
  /** Instructions, in order. */
  how: string[];
  /** A plain list (e.g. what to buy). */
  items?: string[];
  parts: BuildPart[];
  hardware: string[];
  /** Checks and cautions. */
  notes: string[];
  /** The model element to show in the design. */
  locate?: { runId: Id; ownerId: Id };
}

export interface BuildSection {
  id: string;
  title: string;
  intro?: string;
  steps: BuildStep[];
}

export interface BuildPlan {
  sections: BuildSection[];
  /** Total steps, numbered across sections. */
  stepCount: number;
}

const CARCASS_ROLES = new Set(['side', 'top', 'bottom', 'partition', 'fixedShelf', 'back']);

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
/** Cut list letters in order: A … Z, then AA …. */
const sortLabels = (ls: string[]) => ls.sort((a, b) => a.length - b.length || a.localeCompare(b));
const list = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** How parts are joined, as a verb phrase ("glue and screw it"), by the carcass joinery setting. */
function joinVerb(s: ConstructionSettings, them = false): string {
  const it = them ? 'them' : 'it';
  const its = them ? 'their' : 'its';
  switch (s.joinery) {
    case 'dado':
      return `glue ${it} into ${its} dados`;
    case 'rabbet':
      return `glue ${it} into ${its} rabbets`;
    case 'dowel':
      return `glue and dowel ${it}`;
    case 'confirmat':
      return `fasten ${it} with confirmat screws (drill each hole with a confirmat step bit)`;
    default:
      return `glue and screw ${it} (or pocket-screw from a face that won't show)`;
  }
}

export function buildInstructions(project: Project, results: readonly RunResult[], report: CutReport): BuildPlan {
  const fmt = (t: Ticks) => formatLength(t, project.units.system);
  // Long lengths (moldings, banding): feet and inches, or meters.
  const long = (t: Ticks) => (project.units.system === 'metric' ? `${(toMm(t) / 1000).toFixed(2)} m` : formatLength(t, 'imperial', { imperialStyle: 'feetInches', grid: inches(1) }));
  const owners = ownerLabels(project);
  const rowOf = new Map<string, CutListRow>();
  for (const g of [...report.cutList.sheetGoods, ...report.cutList.lumber, ...report.cutList.unknown]) {
    for (const r of g.rows) for (const p of r.parts) rowOf.set(p.key, r);
  }

  /** Group parts into step rows, by cut list row (identical parts), keeping first-seen order. */
  const partsOf = (runId: Id, parts: readonly Part[]): BuildPart[] => {
    const out = new Map<string, BuildPart & { names: string[] }>();
    for (const p of parts) {
      const row = rowOf.get(`${runId}:${p.id}`);
      const key = row ? row.label : `${p.name}|${p.length}|${p.width}|${p.thickness}`;
      const hit = out.get(key);
      if (hit) {
        hit.qty++;
        if (!hit.names.includes(p.name)) hit.names.push(p.name);
      } else {
        out.set(key, { label: row?.label ?? '', name: p.name, names: [p.name], qty: 1, length: row?.length ?? p.length, width: row?.width ?? p.width, thickness: row?.thickness ?? p.thickness, materialId: p.materialId });
      }
    }
    return [...out.values()].map(({ names, ...b }) => ({ ...b, name: names.join(', ') }));
  };
  const labelsOf = (runId: Id, parts: readonly Part[]) => {
    const ls = [...new Set(parts.map((p) => rowOf.get(`${runId}:${p.id}`)?.label).filter((l): l is string => !!l))].sort((a, b) => a.length - b.length || a.localeCompare(b));
    return ls.length ? ls.join(', ') : '';
  };
  const ownerLabel = (runId: Id, ownerId: Id) => owners.get(`${runId}:${ownerId}`)?.label ?? ownerId;

  const all = results.flatMap((r) => r.parts.map((p) => ({ run: r.runId, p })));
  const step = (id: string, title: string, rest: Partial<BuildStep> = {}): BuildStep => ({ id, title, how: [], parts: [], hardware: [], notes: [], ...rest });
  const sections: BuildSection[] = [];

  // ---- 1. Before you start ----
  const start: BuildStep[] = [];
  for (const result of results) {
    const run = project.runs.find((r) => r.id === result.runId);
    if (!run || result.tiers.length === 0 || run.islandOf) continue;
    const wall = run.wall[0]!;
    const bottom = [...result.tiers].sort((a, b) => a.y - b.y)[0]!;
    if (run.kind === 'island') {
      const top = result.parts.find((p) => p.role === 'countertop');
      const depth = top ? top.bounds.depth : bottom.depth;
      start.push(
        step(`room-${run.id}`, `Mark out ${run.name}`, {
          how: [
            `Mark its footprint on the floor: about ${fmt(top?.bounds.width ?? wall.length)} × ${fmt(depth)} at the countertop, square to the walls around it.`,
            'Leave a walkway of at least 36" (42" in a working kitchen) between it and the counters or walls around it.',
            `Check the floor for level over the footprint and note the high spot: ${bottom.toeKick > 0 ? 'the toe kick platform' : 'the boxes'} are shimmed up from there.`,
            'Plan any power (most codes require an outlet in a kitchen island) before the boxes go down.',
          ],
          locate: { runId: run.id, ownerId: run.id },
        }),
      );
      continue;
    }
    const how = [
      `Measure the wall: it should be ${fmt(wall.length)} long${wall.measuredLengths?.length ? ` (you measured ${list(wall.measuredLengths.map(fmt))} elsewhere; the boxes fit the tightest)` : ''}, with ${fmt(wall.ceilingHeight)} to the ceiling.`,
      'Find the studs and mark them on the wall above and below where the boxes go.',
      bottom.toeKick > 0
        ? 'Check the floor for level along the wall and out from it. Note the high spot: the toe kick platform is shimmed up from there.'
        : 'Check the floor for level along the wall and out from it. Note the high spot: the bottom boxes are shimmed up from there.',
      `Draw a level line at ${fmt(bottom.y + bottom.height)} from the floor at its high spot: the top of the ${run.tiers.find((t) => t.id === bottom.tierId)?.name ?? 'bottom'} tier.`,
    ];
    start.push(step(`room-${run.id}`, results.length > 1 ? `Check the room: ${run.name}` : 'Check the room', { how, locate: { runId: run.id, ownerId: run.id } }));
  }
  const shop = report.shopping;
  const buy: string[] = [
    ...shop.sheets.map((s) => `${plural(s.count, 'sheet')} of ${s.name} (${fmt(s.length)} × ${fmt(s.width)})`),
    ...shop.lumber.map((l) => `${l.name}, ${fmt(l.width)} wide: ${l.stock.map((st) => `${st.count} × ${fmt(st.length)}`).join(', ')}`),
    ...shop.byLength.map((l) => `${l.name}: ${long(l.length)} in ${plural(l.pieces, 'piece')} (longest ${long(l.longest)}), plus extra for miters`),
    ...shop.hardware.map((h) => `${h.qty} ${h.unit === 'pair' ? (h.qty === 1 ? 'pair of ' : 'pairs of ') : ''}${h.label.toLowerCase()}${h.typeName ? `: ${h.typeName}` : ''}${h.length ? `, ${fmt(h.length)}` : ''}`),
    ...shop.edgeBanding.map((e) => `Edge banding, ${fmt(e.thickness)} wide: ${long(e.purchaseLength)}`),
  ];
  if (buy.length) start.push(step('buy', 'Buy the materials', { how: ['See the Shopping list tab for the full list. In short:'], items: buy }));
  const tools = toolsFor(project, results);
  start.push(step('tools', 'Gather the tools', { how: [`You'll need: ${list(tools)}.`] }));
  sections.push({ id: 'start', title: 'Before you start', steps: start });

  // ---- 2. Cut and prepare ----
  const prep: BuildStep[] = [];
  for (const n of report.sheets) {
    const rows = sortLabels([...new Set(n.sheets.flatMap((sh) => sh.placements.map((pl) => pl.label)))]);
    prep.push(
      step(`cut-sheet-${n.materialId}-${n.thickness}`, `Cut the ${n.materialName}`, {
        how: [
          `Cut ${plural(n.sheets.length, 'sheet')} into parts ${list(rows)}, following the Sheet layouts tab (it numbers the cuts in order when you turn on the cut order).`,
          'Mark each part with its letter and its front edge as you go.',
        ],
        notes: n.unplaced.length ? [`${plural(n.unplaced.length, 'part')} don't fit a sheet; see the cut list.`] : [],
      }),
    );
  }
  for (const l of report.lumber) {
    const rows = sortLabels([...new Set(l.boards.flatMap((b) => b.cuts.map((c) => c.piece.label)))]);
    prep.push(
      step(`cut-lumber-${l.key}`, `Cut the ${l.materialName} (${fmt(l.width)} wide)`, {
        how: [`Rip ${plural(l.boards.length, 'board')} to ${fmt(l.width)}, then crosscut parts ${list(rows)} as laid out on the Sheet layouts tab.`],
      }),
    );
  }
  if (report.glueUps.length) {
    prep.push(
      step('glue-ups', 'Glue up the wide parts', {
        how: report.glueUps.map((g) => `${g.label}: glue ${g.boards} boards about ${fmt(g.boardWidth)} wide into a ${fmt(g.width)} × ${fmt(g.length)} panel (cut long; trim after).`),
      }),
    );
  }
  const joints = jointSteps(project, results, fmt);
  if (joints.length) prep.push(step('joints', 'Cut the joints', { how: joints }));
  const drill = drillSteps(all.map((a) => a.p), fmt);
  if (drill.length) prep.push(step('drill', 'Drill the holes', { how: drill, notes: ['Positions are on each box sheet (Drawings tab).'] }));
  const banded = all.filter((a) => a.p.bandedEdges?.length);
  if (banded.length) {
    const byLabel = new Map<string, { name: string; edges: string; qty: number }>();
    for (const { run, p } of banded) {
      const label = rowOf.get(`${run}:${p.id}`)?.label ?? p.name;
      const e = byLabel.get(label) ?? { name: p.name, edges: describeBandedEdges(p.bandedEdges), qty: 0 };
      e.qty++;
      byLabel.set(label, e);
    }
    prep.push(
      step('band', 'Band the edges', {
        how: [
          ...[...byLabel.entries()].sort(([a], [b]) => a.length - b.length || a.localeCompare(b)).map(([label, e]) => `${label} (${e.qty} × ${e.name.toLowerCase()}): ${e.edges.toLowerCase()}.`),
          'Iron or glue the banding on, then trim it flush and ease the edges.',
        ],
      }),
    );
  }
  const finishes = finishesUsed(project, all.map((a) => a.p));
  if (finishes.length) {
    prep.push(
      step('prefinish', 'Prime and paint before assembly (optional)', {
        how: [
          `Painted parts: ${list(finishes)}. Flat parts are far easier to paint now than inside a box later.`,
          "Keep paint off glue joints (dados, rabbets and the faces that get glued) and sand lightly between coats; you'll touch up after installing.",
        ],
      }),
    );
  }
  sections.push({ id: 'prepare', title: 'Cut and prepare the parts', steps: prep });

  // ---- 3. Tiers, bottom to top ----
  /** Island countertops, held until the island's back face is in. */
  const deferredTops = new Map<Id, BuildStep[]>();
  for (const result of results) {
    const run = project.runs.find((r) => r.id === result.runId);
    if (!run) continue;
    const runPrefix = results.length > 1 ? `${run.name}: ` : '';
    const tiers = [...result.tiers].sort((a, b) => a.y - b.y);
    const tierIndex = new Map(tiers.map((t, i) => [t.tierId, i]));
    // Each face frame goes on once all its boxes are in: after its highest tier.
    const frameAfter = new Map<number, typeof result.frames>();
    for (const f of result.frames) {
      const last = Math.max(...f.boxIds.map((id) => tierIndexOfBox(result, id, tierIndex)));
      frameAfter.set(last, [...(frameAfter.get(last) ?? []), f]);
    }
    tiers.forEach((tl, ti) => {
      const tier = run.tiers.find((t) => t.id === tl.tierId);
      if (!tier) return;
      const steps: BuildStep[] = [];
      const boxes = result.boxes.filter((b) => b.tierId === tl.tierId).sort((a, b) => a.carcass.x - b.carcass.x);
      const kick = result.parts.filter((p) => p.ownerId === tier.id && p.role === 'toeKick');
      if (kick.length && tier.toeKick) {
        const mitred = kick.some((p) => p.mitres?.length);
        const pieced = kick.some((p) => /Piece \d+ of \d+/.test(p.note ?? ''));
        steps.push(
          step(`kick-${tier.id}`, 'Build and level the toe kick platform', {
            subtitle: `${fmt(tl.toeKick)} tall`,
            how: [
              'Lay out the platform as a ladder: the front and back boards, with the cross pieces between them (one under each joint between boxes, and one at each end).',
              `Glue and screw the cross pieces between the boards, keeping the frame square.${pieced ? ' Long boards are pieced; their joints land on cross pieces.' : ''}`,
              ...(mitred ? ['At each open end, a return runs the full depth and meets the front board in a 45° miter: glue the miter and pin it from both sides.'] : []),
              `Set the platform in place, its front board ${fmt(tier.toeKick.setback)} back from where the face of the frame will be, and level it both ways with shims from the high spot.`,
              run.islandOf
                ? `Set it back to back against the front face's platform, flush at the ends, and screw the two together; screw it to the floor through the cross pieces.`
                : run.kind === 'island'
                  ? 'Screw it to the floor through the cross pieces (or fit it over cleats screwed to the floor).'
                  : 'Screw it to the floor (or to a cleat on the wall) through the cross pieces.',
            ],
            parts: partsOf(run.id, kick),
            notes: ['Check level along the front and back and across each end before moving on: every box above sits on this.'],
            locate: { runId: run.id, ownerId: tier.id },
          }),
        );
      }
      steps.push(...mergeIdentical(boxes.map((b) => ({ label: ownerLabel(run.id, b.id), step: boxStep(project, run, result, b, ownerLabel(run.id, b.id), partsOf, fmt) }))));
      if (boxes.length) steps.push(setBoxesStep(run, result, tl, ti, boxes, ownerLabel, fmt));
      for (const f of frameAfter.get(ti) ?? []) {
        const s = frameStep(project, run, result, f, partsOf, fmt);
        if (s) steps.push(s);
      }
      const top = result.parts.filter((p) => p.ownerId === tier.id && p.role === 'countertop');
      if (top.length && tier.countertop) {
        const glue = report.glueUps.some((g) => g.parts.some((pr) => top.some((p) => pr.key === `${run.id}:${p.id}`)));
        const pieced = top.some((p) => /One of \d+ pieces/.test(p.note ?? ''));
        // An island's top goes on once its back face is built and set too.
        const defer = run.kind === 'island' && !run.islandOf && project.runs.some((r) => r.islandOf === run.id);
        const into = defer ? (deferredTops.get(run.id) ?? deferredTops.set(run.id, []).get(run.id)!) : steps;
        into.push(
          step(`top-${tier.id}`, 'Install the countertop', {
            subtitle: `${fmt(tier.countertop.thickness)} thick`,
            how: [
              ...(glue ? ['Glue it up first if it was made from boards (see Glue-ups), then flatten and cut it to size.'] : []),
              ...(pieced ? ['It comes in pieces: join them over the box joints below (see the cut list notes).'] : []),
              run.kind === 'island'
                ? `Set it on both faces of the island with ${fmt(tier.countertop.frontOverhang)} past the front, ${fmt(tier.countertop.backOverhang ?? tier.countertop.frontOverhang)} past the back and ${fmt(tier.countertop.endOverhang)} past each end.`
                : `Set it on the boxes with ${fmt(tier.countertop.frontOverhang)} past the face of the frame and ${fmt(tier.countertop.endOverhang)} past any open end.`,
              ...(run.kind === 'island' && (tier.countertop.backOverhang ?? 0) > inches(10)
                ? ['Support the seating overhang with brackets or corbels about every 24" (screwed to the back face), or use a top stiff enough to span it.']
                : []),
              'Fasten it from below through the box tops: slotted holes or figure-8 fasteners for solid wood, so it can move across its width.',
            ],
            parts: partsOf(run.id, top),
            locate: { runId: run.id, ownerId: tier.id },
          }),
        );
      }
      if (steps.length) {
        sections.push({
          id: `tier-${tier.id}`,
          title: `${runPrefix}${tier.name} (tier ${ti + 1} of ${tiers.length}, from the bottom)`,
          intro: `${plural(boxes.length, 'box', 'boxes')}${tl.toeKick ? ` on a ${fmt(tl.toeKick)} toe kick` : ''}, ${fmt(tl.height)} tall, ${fmt(tl.depth)} deep.`,
          steps,
        });
      }
    });
    const tops = run.islandOf ? deferredTops.get(run.islandOf) : undefined;
    if (tops?.length) {
      const main = project.runs.find((r) => r.id === run.islandOf);
      sections.push({ id: `island-top-${run.islandOf}`, title: `${main?.name ?? 'Island'}: countertop`, intro: 'Over both faces, once they are set and fastened together.', steps: tops });
    }

    // ---- 4a. Trim ----
    const trim: BuildStep[] = [];
    for (const key of ['crown', 'base'] as const) {
      const parts = result.parts.filter((p) => p.role === 'molding' && p.id.includes(`/${key}-`));
      if (!parts.length) continue;
      const pieced = parts.some((p) => /One of \d+ pieces/.test(p.note ?? ''));
      const returns = parts.some((p) => p.name.endsWith('return'));
      trim.push(
        step(`${key}-${run.id}`, key === 'crown' ? 'Install the crown molding' : 'Install the base molding', {
          how: [
            key === 'crown'
              ? 'Crown sits on the top of the boxes against the ceiling; scribe or caulk the gap at the ceiling.'
              : result.tiers.some((t) => t.toeKick > 0)
                ? 'Base molding covers the toe kick board along the bottom of the boxes; scribe it to the floor and nail it to the kick board and the bottom rail.'
                : 'Base molding runs along the bottom of the boxes at the floor; scribe it to the floor.',
            ...(returns ? ['At open ends, miter the front piece and the return (45°) and return it to the wall.'] : []),
            ...(pieced ? ['Runs longer than your stock are pieced: join them with a scarf joint over a stile (see the cut list notes); glue and pin it.'] : []),
            'Nail it to the frame and the box tops (into solid wood), and set the nails for filling.',
          ],
          parts: partsOf(run.id, parts),
          notes: ['Buy extra length for miters and mistakes (the shopping list gives the net length).'],
        }),
      );
    }
    if (trim.length) sections.push({ id: `trim-${run.id}`, title: `${runPrefix}Trim`, steps: trim });
  }

  // ---- 4b. Doors, drawers and shelves ----
  const fronts: BuildStep[] = [];
  const pick = (pred: (p: Part) => boolean) => all.filter((a) => pred(a.p));
  const byRun = (items: { run: Id; p: Part }[]) => {
    const out: BuildPart[] = [];
    for (const r of results) out.push(...partsOf(r.runId, items.filter((a) => a.run === r.runId).map((a) => a.p)));
    return out;
  };
  const fivePiece = pick((p) => p.role === 'frontFrame' || p.role === 'frontPanel');
  if (fivePiece.length) {
    const s = project.settings.fronts.fivePiece;
    fronts.push(
      step('five-piece', 'Make the five-piece doors and drawer fronts', {
        how: [
          `Cut a ${fmt(s.panelGroove)} deep groove along the inside edge of every stile and rail, centered on the thickness, sized to the panel.`,
          `Cut a ${fmt(s.panelGroove)} long stub tenon on each end of every rail to fit the groove.`,
          `Glue the rails into the stiles around the panel. Don't glue the panel: it floats (${fmt(s.panelClearance)} clear each side) so it can move.`,
          'Check each one is flat and square while the glue sets.',
        ],
        parts: byRun(fivePiece),
      }),
    );
  }
  const drawerBoxes = pick((p) => p.role === 'drawerBox' || p.role === 'drawerBottom');
  if (drawerBoxes.length) {
    const slides = report.hardware.hardware.filter((h) => h.kind === 'drawerSlide');
    fronts.push(
      step('drawers', 'Build the drawer boxes and fit the slides', {
        how: [
          'Cut a groove for the bottom inside the sides, front and back, 1/2" up from the bottom edge.',
          'Glue and nail the sides to the box front and back; slide the bottom into its grooves (no glue) and nail it to the back.',
          'Check each box is square (equal diagonals).',
          'Mount the slides: the cabinet members on the box sides (or on spacers, where the face frame stands proud of the side), level and set back from the frame face by the slide maker’s setback; the drawer members on the drawer boxes.',
        ],
        parts: byRun(drawerBoxes),
        hardware: slides.map(hardwareLine(fmt)),
      }),
    );
  }
  const doors = pick((p) => p.role === 'door' || (p.role === 'frontFrame' && /door/i.test(p.name)));
  if (report.hardware.doors > 0) {
    const hinges = report.hardware.hardware.filter((h) => h.kind === 'hinge');
    const inset = project.settings.fronts.mounting === 'inset';
    fronts.push(
      step('doors', 'Hang the doors', {
        how: [
          'Mount the hinges on the doors (cups in the bored holes), then on the frame or box sides.',
          inset
            ? `Set each inset door in its opening with an even ${fmt(project.settings.fronts.reveal)} gap all round, using the hinge adjustments.`
            : `Adjust the hinges so the doors line up with each other and overlap the ${project.settings.construction === 'frameless' ? 'box edges' : 'frame'} evenly.`,
        ],
        parts: byRun(doors.filter((a) => a.p.role === 'door')),
        hardware: hinges.map(hardwareLine(fmt)),
        notes: [`${plural(report.hardware.doors, 'door')}.`],
      }),
    );
  }
  if (report.hardware.drawers > 0) {
    fronts.push(
      step('drawer-fronts', 'Attach the drawer fronts', {
        how: [
          'Slide each drawer in, hold its front in place with shims or double-sided tape for an even gap, and screw it on from inside the drawer box.',
          'Check the gaps around every front, then add the pulls.',
        ],
        parts: byRun(pick((p) => p.role === 'drawerFront')),
        notes: [`${plural(report.hardware.drawers, 'drawer')}.`],
      }),
    );
  }
  const shelves = pick((p) => p.role === 'adjustableShelf' || (p.role === 'rail' && p.name === 'Shelf nosing'));
  if (shelves.length) {
    const pins = report.hardware.hardware.filter((h) => h.kind === 'shelfPin');
    const nosed = shelves.some((a) => a.p.name === 'Shelf nosing');
    fronts.push(
      step('shelves', 'Set the adjustable shelves', {
        how: [
          ...(nosed ? ['Glue and pin each nosing to its shelf front, top flush with the shelf, ends centered.'] : []),
          'Push the shelf pins into the holes at the heights you want (all four at the same height) and set the shelves on them.',
        ],
        parts: byRun(shelves),
        hardware: pins.map(hardwareLine(fmt)),
      }),
    );
  }
  if (fronts.length) sections.push({ id: 'fronts', title: 'Doors, drawers and shelves', steps: fronts });

  // ---- 4c. Finish ----
  const done: BuildStep[] = [
    step('finish', 'Fill, caulk and finish', {
      how: [
        'Fill the nail holes and any gaps in the face frame joints; sand smooth.',
        'Caulk where the frame and trim meet the walls, the ceiling and the floor.',
        finishes.length ? `Finish coats: ${list(finishes)}. Touch up anything painted before assembly.` : 'Apply your finish.',
      ],
    }),
    step('check', 'Final checks', {
      how: [
        ...(report.hardware.doors > 0 ? ['Doors swing freely and their gaps are even.'] : []),
        ...(report.hardware.drawers > 0 ? ['Drawers run smoothly and close fully.'] : []),
        ...(shelves.length ? ['Shelves sit level on their pins.'] : []),
        'Every box is fastened to the wall and to its neighbors.',
      ],
    }),
  ];
  sections.push({ id: 'finish', title: 'Finish', steps: done });

  const out = sections.filter((s) => s.steps.length);
  return { sections: out, stepCount: out.reduce((n, s) => n + s.steps.length, 0) };

  function hardwareLine(f: (t: Ticks) => string) {
    return (h: CutReport['hardware']['hardware'][number]) => `${h.qty} ${h.unit === 'pair' ? (h.qty === 1 ? 'pair' : 'pairs') : '×'} ${h.typeName ?? h.label}${h.length ? `, ${f(h.length)}` : ''}`;
  }
}

/**
 * One step for each set of identical boxes (same instructions and parts), in order of first
 * appearance: "Build Bottom 1, 2 and 3 (3 identical boxes)", with part counts for all of them.
 */
function mergeIdentical(steps: { label: string; step: BuildStep }[]): BuildStep[] {
  const groups = new Map<string, { labels: string[]; step: BuildStep }>();
  for (const { label, step } of steps) {
    const key = JSON.stringify([step.subtitle, step.how, step.notes, step.parts.map((p) => [p.label, p.qty, p.name, p.length, p.width])]);
    const g = groups.get(key);
    if (g) g.labels.push(label);
    else groups.set(key, { labels: [label], step });
  }
  return [...groups.values()].map(({ labels, step }) => {
    if (labels.length === 1) return step;
    // Shared prefix of the names: "Bottom 1", "Bottom 2" → "Bottom 1, 2 and 3".
    const words = labels.map((l) => l.split(' '));
    const head = words.every((w) => w.length > 1 && w.slice(0, -1).join(' ') === words[0]!.slice(0, -1).join(' ')) ? words[0]!.slice(0, -1).join(' ') : '';
    const names = head ? `${head} ${list(words.map((w) => w.at(-1)!))}` : list(labels);
    return {
      ...step,
      title: `Build ${names} (${labels.length} identical boxes)`,
      how: [`Build ${labels.length} of these the same way.`, ...step.how],
      parts: step.parts.map((p) => ({ ...p, qty: p.qty * labels.length })),
    };
  });
}

function tierIndexOfBox(result: RunResult, boxId: Id, tierIndex: Map<Id, number>): number {
  const b = result.boxes.find((x) => x.id === boxId);
  return b ? (tierIndex.get(b.tierId) ?? 0) : 0;
}

/** Settings that apply to a box (tier box or tall box). */
function boxSettings(project: Project, run: Run, b: BoxLayout): ConstructionSettings {
  if (b.source === 'span') {
    const span = run.spans.find((s) => s.id === b.id);
    return resolveSettings(project, [run, span as SettingsScope | undefined]);
  }
  const tier = run.tiers.find((t) => t.items.some((i) => i.kind === 'box' && i.id === b.id));
  const box = tier?.items.find((i) => i.kind === 'box' && i.id === b.id) as SettingsScope | undefined;
  return resolveSettings(project, [run, tier, box]);
}

/** Assemble one box's carcass. */
function boxStep(
  project: Project,
  run: Run,
  result: RunResult,
  b: BoxLayout,
  label: string,
  partsOf: (runId: Id, parts: readonly Part[]) => BuildPart[],
  fmt: (t: Ticks) => string,
): BuildStep {
  const s = boxSettings(project, run, b);
  const c = b.carcass;
  const own = result.parts.filter((p) => p.ownerId === b.id);
  const carcass = own.filter((p) => CARCASS_ROLES.has(p.role));
  // A part, or its first piece when it was split to fit the stock.
  const get = (suffix: string) => own.find((p) => p.id === `${b.id}/${suffix}` || p.id.startsWith(`${b.id}/${suffix}-piece-`));
  const top = get('top');
  const bottom = get('bottom');
  const finished = get('bottom-finish');
  const back = get('back');
  const verb = joinVerb(s);
  const how: string[] = [];
  const pieced = carcass.filter((p) => /One of \d+ pieces/.test(p.note ?? ''));
  if (pieced.length) how.push(`Join the pieced ${list([...new Set(pieced.map((p) => p.name.toLowerCase()))])} first; the cut list notes say where each joint goes.`);
  how.push('Mark the inside face and front edge of every part, and lay them out.');
  const lowest = finished ?? bottom;
  if (!lowest) how.push("This box has no bottom (it's open below).");
  else if (lowest.bounds.x === c.x) {
    how.push(`Stand the sides on the ${finished ? 'finished bottom' : 'bottom'} (it runs under them${lowest.bounds.z === 0 ? ' and the back' : ''}), flush at the front; ${verb}.`);
    if (finished && bottom) how.push(`Fit the bottom between the sides, its underside ${fmt(bottom.bounds.y - c.y)} up from the bottom of the box, and ${verb}.`);
  } else {
    if (bottom) {
      const up = bottom.bounds.y - c.y;
      how.push(up > 0 ? `Fit the bottom between the sides with its underside ${fmt(up)} up from their bottom ends (its top lines up with the top of the bottom rail), flush at the front, and ${verb}.` : `Fit the bottom between the sides, flush with their bottom ends and fronts, and ${verb}.`);
    }
    if (finished) how.push(`Fit the finished bottom between the sides, flush with their bottom ends: it closes in the space behind the bottom rail. ${verb.charAt(0).toUpperCase() + verb.slice(1)}.`);
  }
  if (top) {
    how.push(top.bounds.x === c.x ? `Set the top over the sides, flush at the front and ends, and ${verb}.` : `Fit the top between the sides, flush with their tops and fronts, and ${verb}.`);
  } else how.push("This box has no top (it's open above).");
  const partitions = own.filter((p) => p.role === 'partition');
  if (partitions.length) {
    const xs = partitions.map((p) => fmt(p.bounds.x - c.x));
    const one = partitions.length === 1;
    how.push(`Fit ${one ? 'the partition' : `the ${partitions.length} partitions`} between the top and bottom, ${one ? 'its left face' : 'their left faces'} ${list(xs)} from the outside of the left side, and ${joinVerb(s, !one)}.`);
  }
  const fixed = own.filter((p) => p.role === 'fixedShelf');
  if (fixed.length) {
    const ys = [...new Set(fixed.map((p) => fmt(p.bounds.y + p.bounds.height - c.y)))];
    how.push(`Fit the fixed shel${fixed.length === 1 ? 'f' : 'ves'} with ${fixed.length === 1 ? 'its top' : 'their tops'} ${list(ys)} up from the bottom of the box, and ${joinVerb(s, fixed.length > 1)}.`);
  }
  if (back) {
    how.push(
      s.back === 'rabbeted'
        ? 'Check the box is square (equal diagonals), then set the back into its rabbets; glue and pin it.'
        : 'Check the box is square (equal diagonals), then glue and nail the back on, flush with the outsides. It holds the box square.',
    );
  } else how.push('There is no back: check the box is square and brace it until it is fastened in place.');
  const endPanels = own.filter((p) => p.name === 'End panel');
  for (const ep of endPanels) {
    const side = ep.bounds.x < c.x + c.width / 2 ? 'left' : 'right';
    how.push(`Glue and clamp the end panel to the outside of the ${side} side, flush at the top, bottom and front: it fills in behind the wide end stile.`);
  }
  const notes = [`Outside size: ${fmt(c.width)} wide × ${fmt(c.height)} tall × ${fmt(c.depth)} deep.`];
  if (s.joinery === 'dado' || s.joinery === 'rabbet') notes.push('Dry-fit before gluing: dados and rabbets close up fast once glue is on.');
  return {
    id: `box-${b.id}`,
    title: `Build ${label}`,
    subtitle: `${fmt(c.width)} W × ${fmt(c.height)} H × ${fmt(c.depth)} D`,
    how,
    parts: partsOf(run.id, [...carcass, ...endPanels.filter((p) => !carcass.includes(p))]),
    hardware: [],
    notes,
    locate: { runId: run.id, ownerId: b.id },
  };
}

/** Set a tier's boxes in place and fasten them. */
function setBoxesStep(
  run: Run,
  result: RunResult,
  tl: RunResult['tiers'][number],
  ti: number,
  boxes: readonly BoxLayout[],
  ownerLabel: (runId: Id, ownerId: Id) => string,
  fmt: (t: Ticks) => string,
): BuildStep {
  const names = boxes.map((b) => ownerLabel(run.id, b.id));
  const on = ti === 0 ? (tl.toeKick > 0 ? 'on the toe kick platform' : 'on the floor (shimmed level)') : 'on the tier below';
  const tall = boxes.filter((b) => b.source === 'span');
  const one = boxes.length === 1;
  const island = run.kind === 'island';
  const how = [
    one ? `Set ${names[0]} ${on}.` : `Set the boxes ${on}, left to right: ${list(names)}.`,
    ...(tall.length ? [`${list(tall.map((b) => ownerLabel(run.id, b.id)))} ${tall.length === 1 ? 'runs' : 'run'} up through the tiers above: brace ${tall.length === 1 ? 'it' : 'them'} plumb.`] : []),
    `Line up ${one ? 'its front with the boxes below' : 'the fronts in one flat plane'} and ${one ? 'its top' : 'the tops'} level at ${fmt(tl.y + tl.height - tl.countertop)} from the floor.`,
    ...(one ? [] : ['Clamp each box to its neighbor, flush at the front, and screw them together through the sides, near the front and back, top and bottom.']),
    island
      ? run.islandOf
        ? `Set ${one ? 'it' : 'them'} back to back against the front face's boxes, flush at the ends, and screw the backs together through both.`
        : `Screw ${one ? 'it' : 'each box'} down to ${ti === 0 && tl.toeKick > 0 ? 'the platform' : 'the floor (or cleats on it)'} through the bottom; there's no wall to hold ${one ? 'it' : 'them'}.`
      : `Screw ${one ? 'it' : 'each box'} to the wall through the back into the studs, near the top${tall.length ? ' (tall boxes near the bottom too)' : ''}.`,
    ...(island && run.islandOf && ti === 0 && tl.toeKick > 0 ? ['Screw them down to their platform through the bottoms.'] : []),
  ];
  const notes: string[] = [];
  if (!island && tl.scribe.left > 0 && run.ends.left === 'wall') notes.push(`Leave about ${fmt(tl.scribe.left)} at the left wall: the scribe stile covers it.`);
  if (!island && tl.scribe.right > 0 && run.ends.right === 'wall') notes.push(`Leave about ${fmt(tl.scribe.right)} at the right wall: the scribe stile covers it.`);
  const gaps = result.gaps.filter((g) => g.rect.y < tl.y + tl.height && g.rect.y + g.rect.height > tl.y);
  if (gaps.length) notes.push('Keep the ends next to openings plumb: they show.');
  const fillers = result.parts.filter((p) => p.name === 'Wall filler' && boxes.some((b) => b.id === p.ownerId));
  if (fillers.length) how.push('Scribe the wall fillers to the wall and screw them to the end boxes.');
  return { id: `set-${tl.tierId}`, title: 'Set and fasten the boxes', how, parts: [], hardware: [], notes, locate: { runId: run.id, ownerId: tl.tierId } };
}

/** Build and attach a face frame (all its boxes are in place). */
function frameStep(
  project: Project,
  run: Run,
  result: RunResult,
  frame: RunResult['frames'][number],
  partsOf: (runId: Id, parts: readonly Part[]) => BuildPart[],
  fmt: (t: Ticks) => string,
): BuildStep | null {
  const ids = new Set(frame.boxIds);
  const parts = result.parts.filter((p) => ids.has(p.ownerId) && (p.role === 'stile' || p.role === 'rail') && p.name !== 'Shelf nosing');
  if (!parts.length) return null;
  const strips = result.parts.filter((p) => ids.has(p.ownerId) && p.name === 'Scribe strip');
  const x0 = Math.min(...parts.map((p) => p.bounds.x));
  const x1 = Math.max(...parts.map((p) => p.bounds.x + p.bounds.width));
  const y0 = Math.min(...parts.map((p) => p.bounds.y));
  const y1 = Math.max(...parts.map((p) => p.bounds.y + p.bounds.height));
  const scribe = parts.filter((p) => p.name === 'Scribe stile');
  const insetRails = parts.filter((p) => p.name === 'Shelf rail' && p.bounds.z < frame.z);
  const through = parts.filter((p) => /Runs through the rail/.test(p.note ?? ''));
  const big = x1 - x0 > inches(96) || y1 - y0 > inches(84);
  const s = boxSettings(project, run, result.boxes.find((b) => ids.has(b.id))!);
  // Which tiers' boxes it covers, bottom to top.
  const tierNames = [...new Set(result.boxes.filter((b) => ids.has(b.id)).sort((a, b) => a.carcass.y - b.carcass.y).map((b) => run.tiers.find((t) => t.id === b.tierId)?.name ?? ''))].filter(Boolean);
  const how = [
    'Lay the frame out face down on a flat surface: the stiles run full height and the rails fit between them.',
    ...(through.length ? ['Where a rail is pieced, its mid stile runs through it: join the rail pieces to that stile.'] : []),
    'Join each rail to the stiles with glue and two pocket screws from the back (or dowels or biscuits). Check the openings against the boxes as you go.',
    ...(big ? [`The frame is ${fmt(x1 - x0)} × ${fmt(y1 - y0)}: build it in sections joined at a shared stile, or assemble it in place on the boxes.`] : []),
    ...(scribe.length ? [`Hold the frame against the boxes and scribe the ${scribe.length === 1 ? 'scribe stile' : 'scribe stiles'} to the wall (they're cut wide for it); plane or sand to the line.`] : []),
    `Glue and nail the frame to the box fronts${s.faceFrame.lip > 0 ? `, overhanging the box insides by ${fmt(s.faceFrame.lip)}` : ', its inside edges flush with the box insides'}.`,
    ...(insetRails.length ? ['Glue the set-back shelf rails to the fixed shelf fronts, tops flush.'] : []),
    ...(strips.length ? ['Fit the scribe strips under the exposed boxes at the wall, flush with the box bottoms.'] : []),
  ];
  return {
    id: `frame-${frame.id}`,
    title: 'Build and attach the face frame',
    subtitle: `${fmt(x1 - x0)} × ${fmt(y1 - y0)}, over ${plural(frame.boxIds.length, 'box', 'boxes')} (${list(tierNames)})`,
    how,
    parts: partsOf(run.id, [...parts, ...strips]),
    hardware: [],
    notes: ['Set the nails and fill the holes later.'],
    locate: { runId: run.id, ownerId: frame.boxIds[0]! },
  };
}

/** Tools the design calls for. */
function toolsFor(project: Project, results: readonly RunResult[]): string[] {
  const parts = results.flatMap((r) => r.parts);
  const has = (pred: (p: Part) => boolean) => parts.some(pred);
  const settings = [project.settings];
  const tools = ['a table saw or track saw', 'a drill/driver', 'clamps', 'a 4\' level and shims', 'a stud finder', 'a brad or pin nailer', 'wood glue'];
  if (has((p) => /dado|rabbet/i.test(p.note ?? '')) || settings.some((s) => s.back === 'rabbeted')) tools.push('a router or dado stack (for dados and rabbets)');
  if (has((p) => p.role === 'stile')) tools.push('a pocket hole jig (face frames)');
  if (has((p) => p.features?.some((f) => f.label === 'Hinge cup') ?? false)) tools.push('a 35 mm Forstner bit (hinge cups)');
  if (has((p) => p.features?.some((f) => f.label === 'Shelf pin') ?? false)) tools.push('a shelf pin jig and bit');
  if (project.settings.joinery === 'confirmat') tools.push('a confirmat step bit');
  if (project.settings.joinery === 'dowel') tools.push('a dowel jig');
  if (has((p) => !!p.bandedEdges?.length)) tools.push('an edge banding iron and trimmer');
  if (has((p) => p.role === 'molding' || !!p.mitres?.length)) tools.push('a miter saw');
  if (has((p) => p.name === 'Scribe stile' || p.name === 'Wall filler')) tools.push('a compass or scribe and a block plane (scribing)');
  if (has((p) => p.role === 'frontFrame' || p.role === 'drawerBottom')) tools.push('a router table or table saw for grooves');
  return tools;
}

/** "Cut the joints" lines: dados and rabbets, rabbeted backs, pieced parts. */
function jointSteps(project: Project, results: readonly RunResult[], fmt: (t: Ticks) => string): string[] {
  const parts = results.flatMap((r) => r.parts);
  const out: string[] = [];
  const s = project.settings;
  if (s.joinery === 'dado' || s.joinery === 'rabbet') {
    out.push(
      `Cut ${fmt(s.joineryDepth)} deep ${s.joinery === 'dado' ? 'dados' : 'rabbets'} in the sides (and the parts that capture partitions and fixed shelves) wherever another part fits into them; the parts that fit in are already cut longer by the joint depth (see the cut list notes).`,
    );
  }
  const rabbeted = parts.filter((p) => /along the back edge for the back/.test(p.note ?? ''));
  if (rabbeted.length) out.push(`Rabbet the back edge of the sides, tops and bottoms for the back (${plural(rabbeted.length, 'part')}); the size is in each part's note.`);
  if (parts.some((p) => /miter/i.test(p.note ?? '') && p.role === 'toeKick')) out.push('Cut the toe kick miters at 45° on the front boards and returns marked in the cut list.');
  return out;
}

/** "Drill the holes" lines from the parts' machining features. */
function drillSteps(parts: readonly Part[], fmt: (t: Ticks) => string): string[] {
  const out: string[] = [];
  const by = new Map<string, { count: number; parts: number; diameter: Ticks; depth: Ticks }>();
  for (const p of parts) {
    const seen = new Set<string>();
    for (const f of p.features ?? []) {
      const e = by.get(f.label) ?? { count: 0, parts: 0, diameter: f.diameter, depth: f.depth };
      e.count++;
      if (!seen.has(f.label)) {
        e.parts++;
        seen.add(f.label);
      }
      by.set(f.label, e);
    }
  }
  const pins = by.get('Shelf pin');
  if (pins) out.push(`Shelf pins: ${pins.count} holes, ⌀${fmt(pins.diameter)} × ${fmt(pins.depth)} deep, in ${plural(pins.parts, 'part')}: two rows per face, 32 mm apart. Use a drilling jig and a stop collar.`);
  const cups = by.get('Hinge cup');
  if (cups) out.push(`Hinge cups: ${cups.count} holes, ⌀${fmt(cups.diameter)} × ${fmt(cups.depth)} deep, in ${plural(cups.parts, 'door')}, centers 22.5 mm from the hinge edge.`);
  return out;
}

/** Finishes in use, as "White paint (face frames, doors)". */
function finishesUsed(project: Project, parts: readonly Part[]): string[] {
  const names = new Map(finishesOf(project).map((f) => [f.id, f.name]));
  const by = new Map<string, Set<string>>();
  for (const p of parts) {
    if (!p.finishId) continue;
    const set = by.get(p.finishId) ?? new Set<string>();
    set.add(ROLE_WORD[p.role] ?? p.role);
    by.set(p.finishId, set);
  }
  return [...by.entries()].map(([id, roles]) => `${names.get(id) ?? id} (${list([...roles])})`);
}

const ROLE_WORD: Record<string, string> = {
  side: 'boxes',
  top: 'boxes',
  bottom: 'boxes',
  partition: 'boxes',
  back: 'backs',
  fixedShelf: 'shelves',
  adjustableShelf: 'shelves',
  stile: 'face frames',
  rail: 'face frames',
  door: 'doors',
  drawerFront: 'drawer fronts',
  frontFrame: 'five-piece fronts',
  frontPanel: 'five-piece fronts',
  toeKick: 'toe kicks',
  countertop: 'countertops',
  filler: 'fillers',
  molding: 'molding',
  drawerBox: 'drawer boxes',
  drawerBottom: 'drawer boxes',
};
