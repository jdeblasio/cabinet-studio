# Built-in Planner — Design

Status: draft · Source: design interview, 2026-11-07

Decisions below were made explicitly unless marked **(assumed)**, which means a default
chosen to fill a gap; revisit freely. Section 16 lists what is still open.

---

## 1. Vision and audience

Design software for built-in cabinets and shelving, aimed at **serious amateurs and lean
professional shops**: accurate, build-ready output without every conceivable knob.

The **parametric model is the single source of truth**. Three outputs are equally
first-class views of it:

1. Cut list + optimized sheet/lumber layouts
2. Dimensioned 2D drawings
3. 3D visualization

## 2. Platform and distribution

| Topic | Decision |
|---|---|
| Platform | Web app (browser) |
| Stack | TypeScript, React, react-three-fiber (three.js) for 3D, SVG for 2D |
| Storage | Local-first: IndexedDB + export/import of project files. No accounts, no backend, works offline. The browser keeps a library of projects (one record each; switch, new, duplicate, delete); importing a file whose project is already saved creates a copy |
| Distribution | Free / open source, static hosting |
| License | AGPL-3.0 |
| Shop usage | Print-first. Desktop-sized UI; the shop works from the PDF set. No touch/tablet optimization |

## 3. Space definition

- The user defines **wall runs**: connected wall segments in plan.
- Each wall carries **measured irregularity**: multiple width/height measurements (e.g.
  top/middle/bottom), out-of-plumb, out-of-level floor.
- Each wall carries **obstacles** (windows, outlets, vents, baseboard) and **gaps** where
  the wall is unavailable (e.g. a door frame taking part of the wall).

### v1 layout scope

| Layout | v1? |
|---|---|
| Straight wall runs (with gaps) | Yes |
| Freestanding units / islands (finished ends and backs) | Yes |
| Bridges over gaps (e.g. upper box spanning a doorway between two towers) | Yes |
| Corners (L/U-shaped) | **No**, but the data model supports connected segments with angles from day one so corners can be added without a rewrite |
| Sloped ceilings | No. All parts are rectangular, which keeps guillotine nesting simple |

## 4. Layout model

```
Project
└── Wall run (one or more connected segments; v1: straight)
    ├── Measurements, obstacles, gaps
    ├── Spanning elements (run-level): tall boxes, floor gaps; each spans chosen tiers
    └── Tiers (horizontal bands, e.g. base / countertop / upper / crown zone)
        │   each with its own height and depth
        └── Boxes (carcasses), laid out left→right with fixed + flex sizing
            ├── Interior: fixed shelves, adjustable shelves, vertical dividers/cubbies
            └── Fronts: doors, drawers (or none = open box)
```

- **Building block: stacked boxes.** Each module is a real carcass. "Open shelving" means
  an open box (no fronts); there are no carcass-less shelf elements (cleat shelves,
  floating shelves, standards) in scope.
- **Tiers span the whole run.** Each tier lays out its own boxes independently; uppers need
  not align with bases.
- **Spanning boxes reserve space.** A tall box or a floor gap (doorway) is placed at the run
  level and spans chosen tiers. Each spanned tier treats it as a fixed-width reserved slot
  and flexes around it. A bridge is a box in an upper tier positioned over a gap.

### Width sizing: fixed + flex (CSS-like)

- Each box is either **fixed** width or **flex** (optional min / max / ratio).
- Flex boxes divide the space left after fixed boxes, reserved slots, gaps, and
  fillers/scribes.
- Changing a measurement re-flows the run automatically.
- Resolution (implemented): fixed items take their size; flex items share the rest by
  ratio, clamped to min/max (violators are frozen and the rest re-distributed, as in CSS).
- Flex sizes snap **down** to the grid, so flex boxes with equal ratios come out identical
  (identical parts in the cut list). The leftover goes to the **wall-end scribe stiles**:
  split evenly when both ends are walls, otherwise to the one wall end. A region between
  two spanning elements (no wall) gives its leftover to its rightmost flex box.
- Inside a box, a split's leftover goes to its last flex child (bottom row / right column).
- Over-filled tiers or splits are reported as errors; nothing is blocked.

### Editing: dragging a boundary

Dragging the edge between two neighbors **keeps each one's type**: a fixed item gets a new
fixed size; a flex item gets a new ratio. Between two flex neighbors their combined ratio
is redistributed in proportion to the new sizes, so the run still re-flows when the wall
changes. Fixed + flex changes only the fixed one. The same rule applies to tier heights and
to split children.

**Alignment snapping (implemented).** Box boundaries and split lines snap, within a few
pixels, to box edges, gap edges and split lines elsewhere in the run (a box's own tier is
excluded, since its edges move with the drag). A dashed guide shows the alignment. Flex
sizes round down to the grid, so a naive snap can land a grid step off. The editor tries
nearby grid steps and keeps the one whose derived boundary lands exactly on the target.
Some positions can't be reached while equal flex boxes stay equal: with three equal flex
boxes and the remainder split between two wall scribes, about one 1/32" position in three
is out of reach. Then the flex neighbor's ratio is also nudged, so that box ends up a grid
step or two off its siblings. Hold Alt/Option to drag freely.

## 5. Fitting to measured walls

**Tightest + user choice.**

- Boxes are sized to the **tightest** measurement minus a clearance.
- For **each edge** where the built-in meets the room, the user chooses how variance is
  absorbed:
  - scribe strip
  - filler
  - face-frame overhang (stile wider than the box)
  - trim/molding cover
- Floor out-of-level defaults to being absorbed by the leveling base / toe kick **(assumed)**.

## 6. Construction

### Carcass

| Topic | Decision |
|---|---|
| Construction styles | **Both** frameless (32 mm / European) and face frame, chosen per project, overridable per box |
| Carcass joinery | **Small preset menu**: butt (screws/pocket), dado, rabbet, dowel/confirmat. Each preset knows how it changes part sizes. Set at project level with per-joint override |
| Backs | Back presets per box: full back (inset in rabbet/dado, or applied) or no back. Plus **hanging rails / nailers** for fastening to studs. Open boxes typically get a finished back |
| Freestanding | Finished ends and finished back |

### Face frames

- **Continuous**, not per box: shared stiles where boxes meet, wide stiles at walls for
  scribing.
- Frames are grouped by **coplanar front face**, not strictly by tier. A tall box flush with
  the base tier joins the base frame (long stile running full height). Set-back uppers get
  their own frame.
- Face-frame joints use the same preset menu, e.g. pocket screw, dowel, mortise & tenon
  with tenon-length allowance on rails **(assumed)**.
- Default lip: **flush inside** (frame inner edges line up with box side inner faces, so
  drawer slides mount without spacers). A shared stile is then exactly 2 × side thickness.

### Derivation conventions (face frame and frameless, butt joints)

- Sides run full height; top and bottom are captured between the sides.
- An applied back covers the full rear of the box; sides/top/bottom are (depth − back) deep.
- The frame is flush with the carcass top and bottom. The bottom panel, and each fixed
  shelf, is raised so its top surface is flush with the top edge of the rail below it.
- Split child sizes are **clear face-opening sizes** (inside the frame).
- A stile over a partition is as wide as a shared stile between boxes (2 × (side + lip)),
  so a partitioned box reads exactly like boxes side by side and its stiles line up with
  box boundaries in other tiers. The mid stile setting applies to stile-only dividers.
- Stiles are derived per frame group at every vertical boundary: shared stiles cover both
  sides; an end stile at a wall runs to the wall (scribe space); an end stile elsewhere
  (open end, beside a gap or a set-back box) is flush with the side by default. The
  `faceFrame.endStiles.left/right` setting (cascades like any other) can make it
  **full width** instead: as wide as a shared stile and centered on the box edge,
  overhanging the side, so it lines up with shared stiles in a tier above or below.
  Layout reserves the overhang at that end of the tier region (beside a gap, at an open
  run end, or next to a box with a different face plane), so the flex boxes shrink and the
  stile's outer edge lands on the region edge. An **end panel** (a doubled side, carcass
  material, wall to frame) fills in behind the overhang, so the exposed end is flush.
  Tall (span) boxes have fixed widths and get no reserve: lint notes how far their
  overhang reaches into a gap, and warns if it would run into a box with a different face
  plane.
- A shared stile between a base box and a flush tall box runs the tall box's full height,
  so above the base it stands proud of the tall box's side by one side thickness.
- Rails are per box. Where two same-plane tiers stack, each box keeps its own top/bottom
  rail (a doubled rail band); merging them into one rail is a later refinement. Setting the
  lower box's top to **open** avoids the doubled band today.
- **Exposed bottoms:** a box not resting on the floor, a carcass or a countertop across
  the span between its sides (e.g. over a gap or an open space tier) gets a flush
  underside. A **finished bottom** panel at the carcass bottom closes the recess behind
  the bottom rail. If the rail is narrower than two panels, the single bottom panel drops
  flush instead, which leaves a small step up to the rail inside.
- **Open top / bottom** (`carcass.top` / `carcass.bottom`, cascades): an open edge has no
  panel and no rail, so the face opening and the shelf interior run to the carcass edge.
  Fronts stop half a reveal short of an open edge instead of overlaying a rail that isn't
  there. Uses: open shelves over a countertop (the counter is the bottom shelf), or shelving
  that continues into the box above.
- **Frameless** (per project or per box): no face frame. The face opening is the box
  interior, fronts sit on the carcass edges (full overlay covers the side less half the
  reveal; between openings, half a shelf/partition edge each), the bottom panel is flush with
  the carcass bottom, panel dividers are just the shelf or partition, and frame-only dividers
  vanish so stacked drawers meet at the reveal. Full-width end stiles don't apply. At a
  wall, a filler in the plane of the fronts closes the scribe space. Countertops and toe
  kicks measure from the carcass front.
- **Fronts:** each door or drawer front is a **slab** (front material) or **five-piece**
  (`fronts.doorStyle` / `fronts.drawerStyle`): two full-height stiles, two rails between them
  whose cut length adds a stub tenon (the groove depth) at each end, and a panel that fills
  the grooves less a clearance per side, centered in the frame's thickness. A front too small
  for its frame stays a slab (lint info). Frame and panel materials are their own roles.
- **Drawer boxes** (side-mount slides): width = clear opening − 2 × slide clearance; height =
  opening − top and bottom clearances; depth = the longest standard slide that fits between
  the back of the drawer front and the back panel less a rear clearance (lint warns when none
  fits). Sides run full depth; the box front and back sit between them (butt joints); the
  bottom is captured in grooves 1/2" up. The box front sits against the back of the front.
- **Countertop** (per tier: thickness, front overhang, end overhang): sits inside the tier's
  height, so the carcasses get shorter and the counter surface stays put. One slab per
  contiguous run of boxes, from the wall to the face of the face frame plus the front
  overhang. At each end it runs to a wall, overhangs an open end or gap by the end overhang
  (measured from a full-width end stile's outer edge), or stops at another box. A stile that
  runs up past it (shared with a tall box) gets a lint note to notch the top. Its thickness
  is set on the tier; the countertop material only supplies species and color.
- Toe kick: a separate ladder-frame platform per contiguous, same-depth run of floor
  boxes; the kick face is set back from the face of the face frame. At an open end with a
  full-width end stile the platform runs under the end panel, flush with the finished end;
  at a wall the front kick board runs on to the wall (scribed).
- **Scribe strips:** a box held off a wall by the scribe allowance leaves a slot behind its
  scribe stile. Normally the box below at the same wall (or the floor) closes it; when
  nothing does (e.g. a box over a doorway that runs to the wall), a strip of face-frame
  stock fills the slot at the box bottom, flush with it, ripped to the scribe width.
- Fronts: partial overlay adds the overlay on every edge; inset subtracts the reveal; full
  overlay covers this opening's share of each frame member, leaving `reveal` between
  neighboring fronts. Front and interior part sizes snap down to the grid.

### Interiors

- Fixed shelves (joined like carcass parts)
- Adjustable shelves with shelf-pin hole lines
- Vertical dividers / cubbies

### Fronts

| Topic | Decision |
|---|---|
| Types | Doors (single/pair), drawers |
| Construction | **Slab** (sheet goods) and **5-piece / Shaker** broken into rails, stiles, and panel with tongue/groove allowances in the cut list |
| Mounting | Full overlay, partial overlay, inset. Set per project, overridable per box |
| Drawer boxes | Full parts (sides, front, back, bottom) sized from slide specs, with a preset joinery menu: butt, rabbet, dado, lock-rabbet; dovetail as a size-only option |

### Trim and finishing (all in 3D, drawings, and cut list)

- Toe kick: integral, or separate leveling base/platform, plus kick boards
- Scribe strips and fillers (derived from measurements and per-edge choices)
- Edge banding / solid edging, including its effect on part dimensions
- Crown molding, base molding, countertops/top panels with overhangs

## 7. Materials and hardware

### Materials library (user-editable)

- **Sheet goods:** actual thickness (e.g. 23/32"), sheet size, grain direction.
- **Solid lumber:** for face frames, edging, 5-piece fronts; tracked by length / board feet.
- Parts get a material **by role** (carcass, back, drawer box, face frame, ...).
- **No prices.**

### Hardware

- **Generic parametric types**: drawer slides (side clearance, available lengths), hinges
  (overlay, cup boring), shelf pins (diameter).
- Shipped with a **seed catalog** of a handful of common real products (Blum, Salice,
  Accuride, ...) that users can copy and edit.
- Hardware specs drive clearances, drilling, and the shopping list.

## 8. Units and precision

- **Per-project unit system**: each project is imperial or metric. Its grid (e.g. 1/32" or
  0.5 mm) is the snap grid.
- The other unit system is **display-only**: rounded and marked approximate.
- **Snap to precision**: all inputs and derived sizes snap to the project grid, so what you
  see is exactly what's computed.
- **Off-grid material thickness** (e.g. 18 mm in an imperial project): **exterior wins,
  interior snaps**. User-facing box W/H/D stay on-grid; derived interior parts snap toward
  a slightly loose fit; lint notes the rounding.
- Internal storage: integer ticks of **1/8128"** (≈ 3.125 µm), which represent both systems
  exactly: 1/64" = 127 ticks, 0.1 mm = 32 ticks (implemented).

## 9. Settings: cascade + named styles

- Settings (materials, joinery, overlay, reveals, hardware, ...) cascade:
  **Project → Run → Tier → Box → Part**.
- Each level inherits; overrides are visibly marked with "reset to inherited". The inspector
  shows where each value comes from.
- **Named styles** (e.g. "Shaker inset, 3/4 ply, dado") can be applied at any level; editing
  a style propagates to everything using it.

## 10. Validation

- **Lint panel**, never blocking: live problems list split into errors and warnings, with
  click-to-locate.
- Geometric/fit checks: part exceeds any sheet, overlaps, no slide fits drawer depth, door
  too wide, rounding notes from Section 8, etc.
- **Engineering checks**: shelf sag from span, material, and load.

## 11. Outputs

### Cut list and optimization

- **Guillotine-only** sheet layouts: every cut runs edge-to-edge, so it's buildable on a
  table saw or track saw. Honors kerf, trim, and grain.
- **1D lumber optimization** for solid stock (rails and stiles from standard board lengths).
- No CNC / free-form nesting.
- **Constraints, not edits**: users don't drag parts on sheets. They steer the optimizer:
  lock grain per part, mark sheets as offcuts/partial, group parts onto one sheet (e.g.
  grain-matched doors), set kerf/trim.

### Drawings

- Elevations + plan view
- Sections (depths, tiers, toe kick, crown, countertop overhangs)
- Per-box assembly sheets (parts, joinery callouts)
- Per-part drawings with drilling (shelf pins, hinge cups, slide holes) and dado locations.
  The model therefore tracks **machining features as real geometry**.
- **Auto + annotations**: drawings and dimensions regenerate from rules on every change;
  users can add notes/callouts/extra dimensions **anchored to model geometry** that survive
  regeneration.

### 3D

- Configurable display modes (e.g. shaded with wood tones, wireframe, exploded).
  Photoreal rendering is not a goal.
- Moldings as simplified profiles.

### Exports

- PDF drawing set (drawings, cut list, sheet layouts)
- CSV / XLSX cut list
- 3D model: STL / OBJ / glTF
- No DXF/SVG export

### Shopping list

- Quantities only: sheets, board feet/lengths, hardware counts, edge banding length.
  **No prices.**

## 12. Editing UX

- **Primary surface: interactive 2D front elevation** (select a box, drag a divider, add a
  tier) with a side **inspector** for properties.
- **3D is a live preview** pane, not the main editor.
- Undo/redo throughout **(assumed)**.

## 13. Architecture (assumed)

- **Derivation engine as a pure TypeScript package** separate from the UI:
  `design model → derived parts + machining features → cut list → optimization`.
  Deterministic and heavily unit-tested.
- Optimizer runs in a **Web Worker** so the editor stays responsive.
- Project files are **versioned JSON** with schema migrations.
- Static site; no server components.

## 14. Milestones

### Milestone 1: editor UX (decided)

Proves the design experience:

- Elevation editor + inspector
- One straight wall run, tiers, fixed + flex layout, spanning boxes
- **Face-frame** construction, butt joints
- 3D preview showing **real derived panels** (sides, tops, shelves, doors with thickness);
  the derivation engine starts here
- No cut list or nesting yet

### Later milestones (proposed, not decided)

1. Materials library, joinery presets, cut list, guillotine + 1D optimization
2. Frameless construction, drawers + drawer boxes, hardware library, 5-piece fronts
3. Measured irregularity + per-edge fit choices, scribes/fillers, trim elements
4. Drawings (elevation, plan, section, box sheets, part drawings), annotations, PDF export
5. Cascade + named styles UI, lint panel with engineering checks
6. Freestanding units, bridges over gaps, CSV/XLSX and 3D exports
7. Post-v1: corners (L/U), then reconsider sloped ceilings, CNC nesting, tablet shop mode

## 15. Out of scope for v1

- Corners (data model ready; UI and derivation deferred)
- Sloped ceilings / non-rectangular parts
- Carcass-less shelving (cleat, floating, standards)
- CNC / free-form nesting, DXF/SVG export
- Pricing, labor estimates, quoting
- Accounts, cloud sync, sharing
- Tablet/touch UI
- Photoreal rendering

## 16. Open questions

- **Bridges:** how a bridge box is supported (on flanking towers' tops vs. hung from the wall)
  and how its face frame joins neighbors.
- **Freestanding units:** modeled as a run with no wall, or a distinct entity?
- **Countertops:** they are shop-built parts today. Should ordered tops (stone, laminate;
  size-only, not in the cut list) be an option? Should a top bridge a gap (desk knee space)?
- **Moldings:** profile library vs. bounding-box profiles; miter returns at run ends.
- **Grain matching** across door pairs / drawer banks beyond "group onto one sheet".
- **Shelf sag model:** which formula and default load assumptions.
- **Drawing layout:** pagination, sheet sizes, title block.
- **Later milestone ordering** (Section 14).
