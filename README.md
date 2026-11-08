# Built-in Planner

Design software for built-in cabinets and shelving: a parametric model of a wall run
(tiers of boxes, tall boxes, doorways) from which parts, drawings, cut lists and sheet
layouts are derived. See [DESIGN.md](DESIGN.md) for the product design and decisions.

Free and open source under the AGPL-3.0.

## What it does

- **Design** a wall run as tiers of boxes with fixed and flex widths, tall boxes and gaps
  (doorways, knee space), in a front elevation with an inspector and a live 3D preview
  (shaded, wireframe, exploded). Boundary drags snap to edges in other tiers.
- **Construction:** face frame or frameless, per project, tier or box. Settings cascade
  (project → run → tier → box) with named styles.
  - **Joinery and fronts:** butt, dowel, confirmat, dado or rabbet joints; tops over and
    bottoms under the sides (or automatically, to hide raw edges); applied or rabbeted backs;
    slab or five-piece doors and drawer fronts in partial overlay, full overlay or inset.
  - **Parts:** drawer boxes sized from the chosen slides; adjustable and fixed shelves (fixed
    shelves with flush or inset rails; adjustable ones banded or with a frame nosing);
    partitions.
  - **Oversize parts:** optionally pieced at hidden joints (on partitions, fixed shelves, mid
    stiles) when they're bigger than your sheets or boards.
  - **Trim:** countertops (which can bridge a gap), toe kicks, crown and base molding,
    end panels, scribe strips and wall fillers.
  - **Finishing and hardware:** paints and finishes per kind of part, edge banding, shelf pin
    and hinge cup drilling, and a hardware library (slides, hinges and pins shown in 3D).
- **Fit the room:** walls take extra length and ceiling measurements. Boxes fit the
  tightest and scribe stiles are cut to scribe to the rest.
- **Check:** a problems panel lints the design (e.g. shelf sag from a beam model, drawers
  with no slide that fits, crowded shelves).
- **Outputs:**
  - Cut list with CSV export.
  - Guillotine sheet layouts and lumber cutting lists.
  - Shopping list (quantities only).
  - Printable drawing set: elevations, plans, sections and box sheets.
  - 3D export (glTF, OBJ, STL).
- **Local-first:** projects live in the browser (switch, duplicate, delete), with JSON
  export and import. No accounts.

## Layout

- `packages/engine`: pure TypeScript design model and derivation engine (no UI).
  - `model.ts`: the persisted design model; `derived.ts`: derived output types.
  - `units.ts` / `format.ts`: integer length ticks (1/8128"), parsing and formatting.
  - `derive/`: the derivation pipeline:
    - `layout.ts`: run layout and the flex solver.
    - `box.ts`: box parts, fronts, drawers and machining.
    - `frame.ts`: face frames.
    - `toeKick.ts`, `countertop.ts`, `scribe.ts`, `trim.ts`: trim and fillers.
    - `checks.ts`: engineering checks.
  - `cutlist/`: cut list, guillotine sheet nesting, lumber optimization, shopping list, CSV.
  - `export3d.ts`: glTF, OBJ and STL export.
  - `ops.ts`: model edit helpers used by the editor.
- `apps/web`: the browser editor (React, react-three-fiber, zustand).
  - `components/elevation`, `inspector`, `preview`: the design view.
  - `components/project`: the Project tab (units, materials, hardware, styles, construction
    defaults).
  - `components/outputs`: cut list, sheet layouts and shopping list views.
  - `components/drawings`: the printable drawing set.
  - `store/`: editor state, undo, the project library (IndexedDB) and derived results.

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev          # start the web editor
pnpm test         # run all tests
pnpm typecheck
```
