# Built-in Planner

Design software for built-in cabinets and shelving: a parametric model of a wall run
(tiers of face-frame boxes, tall boxes, doorways) from which parts, drawings and cut lists
are derived. See [DESIGN.md](DESIGN.md) for the product design and decisions.

Free and open source under the AGPL-3.0.

## Layout

- `packages/engine`: pure TypeScript design model and derivation engine (no UI).
  - `model.ts`: the persisted design model; `derived.ts`: derived output types.
  - `units.ts` / `format.ts`: integer length ticks (1/8128"), parsing and formatting.
  - `derive/`: flex solver, run layout, box parts, face frames, toe kick.
  - `ops.ts`: model edit helpers used by the editor.
- `apps/web`: the browser editor (React, react-three-fiber).

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev          # start the web editor
pnpm test         # run all tests
pnpm typecheck
```
