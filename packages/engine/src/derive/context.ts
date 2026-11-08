import type { Issue, Part, PartRole, Bounds } from '../derived';
import { formatLength } from '../format';
import type { Id, Project, Run } from '../model';
import { inches, isOnGrid, snap, type Ticks } from '../units';

/** Shared state for one deriveRun call. */
export interface Ctx {
  project: Project;
  run: Run;
  grid: Ticks;
  issues: Issue[];
  fmt: (t: Ticks) => string;
  /** Thickness of a material; reports missing materials once and falls back to 3/4". */
  thickness: (materialId: Id, sourceId: Id) => Ticks;
  /** Snap a derived interior size down to the grid (toward a slightly loose fit). */
  down: (t: Ticks) => Ticks;
  issue: (severity: Issue['severity'], code: string, sourceId: Id, message: string) => void;
  /** Materials seen whose thickness is off the project grid. */
  offGridMaterials: Set<Id>;
}

export function makeCtx(project: Project, run: Run, issues: Issue[]): Ctx {
  const grid = project.units.grid;
  const missing = new Set<Id>();
  const offGridMaterials = new Set<Id>();
  return {
    project,
    run,
    grid,
    issues,
    fmt: (t) => formatLength(t, project.units.system),
    thickness(materialId, sourceId) {
      const m = project.materials.find((mat) => mat.id === materialId);
      if (!m) {
        if (!missing.has(materialId)) {
          missing.add(materialId);
          issues.push({
            severity: 'error',
            code: 'material-missing',
            message: `Material "${materialId}" not found; using 3/4" thickness.`,
            sourceId,
          });
        }
        return inches(0.75);
      }
      if (!isOnGrid(m.thickness, grid)) offGridMaterials.add(m.id);
      return m.thickness;
    },
    down: (t) => snap(t, grid, 'down'),
    issue(severity, code, sourceId, message) {
      issues.push({ severity, code, sourceId, message });
    },
    offGridMaterials,
  };
}

/** Build a Part; length runs along the grain (vertical: y extent; horizontal: x extent). */
export function makePart(args: {
  id: Id;
  name: string;
  role: PartRole;
  materialId: Id;
  bounds: Bounds;
  grain: 'vertical' | 'horizontal';
  /** Which bounds axis is the thickness. Default: z for panels facing front, else inferred. */
  thicknessAxis: 'x' | 'y' | 'z';
  ownerId: Id;
  /** Override the computed length/width (e.g. snapped cut sizes). */
  length?: Ticks;
  width?: Ticks;
}): Part {
  const { bounds: b, thicknessAxis: ta } = args;
  const thickness = ta === 'x' ? b.width : ta === 'y' ? b.height : b.depth;
  // The two face dimensions, excluding the thickness axis.
  const dims = { x: b.width, y: b.height, z: b.depth };
  const faceAxes = (['x', 'y', 'z'] as const).filter((a) => a !== ta);
  const lengthAxis =
    args.grain === 'vertical'
      ? faceAxes.includes('y')
        ? 'y'
        : faceAxes[0]!
      : faceAxes.includes('x')
        ? 'x'
        : faceAxes[0]!;
  const widthAxis = faceAxes.find((a) => a !== lengthAxis)!;
  return {
    id: args.id,
    name: args.name,
    role: args.role,
    materialId: args.materialId,
    length: args.length ?? dims[lengthAxis],
    width: args.width ?? dims[widthAxis],
    thickness,
    bounds: b,
    ownerId: args.ownerId,
  };
}
