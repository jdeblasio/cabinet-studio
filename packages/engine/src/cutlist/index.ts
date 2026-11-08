/**
 * Cut list, sheet nesting (guillotine), lumber optimization and shopping list.
 *
 *   design → deriveProject → parts → buildCutReport → cut list rows, sheet layouts,
 *   lumber boards, glue-ups, shopping list and issues.
 *
 * Everything here is pure and deterministic.
 */
import type { RunResult } from '../derived';
import { formatLength } from '../format';
import type { Project } from '../model';
import type { Ticks } from '../units';
import { buildCutList, describeRowNote, type CutList, type CutListRow } from './cutlist';
import { estimateHardware, type HardwareEstimate } from './hardware';
import { planLumber, type GlueUp, type LumberPlan } from './lumber';
import { DEFAULT_CUTLIST_OPTIONS, type CutListOptions } from './options';
import type { CutIssue } from './parts';
import { nestSheetGroup, type SheetNesting } from './sheets';
import { buildShoppingList, type ShoppingList } from './shopping';

export * from './options';
export * from './parts';
export * from './cutlist';
export * from './guillotine';
export * from './sheets';
export * from './lumber';
export * from './hardware';
export * from './shopping';
export * from './csv';

export interface CutReport {
  options: CutListOptions;
  cutList: CutList;
  /** One per sheet material that has parts. */
  sheets: SheetNesting[];
  /** One per lumber (material, thickness, rip width). */
  lumber: LumberPlan[];
  glueUps: GlueUp[];
  hardware: HardwareEstimate;
  shopping: ShoppingList;
  /** The cut list's own problems (parts that don't fit, thickness mismatches, …), errors first. */
  issues: CutIssue[];
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

function rowIssues(project: Project, cutList: CutList): CutIssue[] {
  const fmt = (t: Ticks) => formatLength(t, project.units.system);
  const issues: CutIssue[] = [];
  const what = (r: CutListRow) => {
    const names = r.names.slice(0, 3).join(', ') + (r.names.length > 3 ? ', …' : '');
    return `${r.qty > 1 ? `${r.qty} × ` : ''}${names} (${r.label}, ${fmt(r.length)} × ${fmt(r.width)})`;
  };
  const base = (r: CutListRow) => {
    const owner = r.owners[0];
    return { sourceId: owner?.ownerId ?? r.materialId, ...(owner ? { runId: owner.runId } : {}), partKeys: r.parts.map((p) => p.key) };
  };
  const missingSeen = new Set<string>();
  for (const g of [...cutList.sheetGoods, ...cutList.lumber, ...cutList.unknown]) {
    for (const r of g.rows) {
      for (const n of r.notes) {
        switch (n.kind) {
          case 'missingMaterial':
            if (missingSeen.has(g.materialId)) break;
            missingSeen.add(g.materialId);
            issues.push({ severity: 'error', code: 'cutlist-material-missing', message: `Material "${g.materialId}" is not in the project; ${g.parts} part${g.parts === 1 ? '' : 's'} can't be laid out.`, ...base(r) });
            break;
          case 'noSheetSize':
            if (missingSeen.has(g.materialId)) break;
            missingSeen.add(g.materialId);
            issues.push({ severity: 'error', code: 'sheet-size-missing', message: `${g.name} has no sheet size, so its parts can't be nested.`, ...base(r) });
            break;
          case 'noStock':
            if (missingSeen.has(g.materialId)) break;
            missingSeen.add(g.materialId);
            issues.push({ severity: 'error', code: 'lumber-no-stock', message: 'No lumber stock lengths are set, so lumber parts can\'t be optimized.', ...base(r) });
            break;
          case 'exceedsSheet':
            issues.push({
              severity: 'error',
              code: 'part-exceeds-sheet',
              message: `${what(r)} ${r.qty > 1 ? "don't" : "doesn't"} fit a ${fmt(n.sheetLength)} × ${fmt(n.sheetWidth)} sheet of ${g.name}${n.fitsAcrossGrain ? ' with the grain; it would fit across the grain' : ''}. Split the part or use larger stock.`,
              ...base(r),
            });
            break;
          case 'tooLong':
            issues.push({
              severity: 'error',
              code: 'part-exceeds-stock',
              message: `${what(r)} ${r.qty > 1 ? 'are' : 'is'} longer than the longest ${g.name} board (${fmt(n.stockLength)}, ${fmt(n.usable)} usable). Splice it or buy longer stock.`,
              ...base(r),
            });
            break;
          case 'thicknessMismatch':
            issues.push({
              severity: 'warning',
              code: 'thickness-mismatch',
              message: `${what(r)} ${r.qty > 1 ? 'are' : 'is'} ${fmt(r.thickness)} thick, but ${g.name} is ${fmt(n.materialThickness)}.`,
              ...base(r),
            });
            break;
          case 'glueUp':
            issues.push({ severity: 'info', code: 'glue-up', message: `${what(r)}: ${describeRowNote(n, fmt)}.`, ...base(r) });
            break;
        }
      }
    }
  }
  return issues;
}

/** Cut list, sheet layouts, lumber plan and shopping list for derived results. Pure and deterministic. */
export function buildCutReport(project: Project, results: readonly RunResult[], options: CutListOptions = DEFAULT_CUTLIST_OPTIONS): CutReport {
  const cutList = buildCutList(project, results, options);
  const sheets: SheetNesting[] = [];
  for (const g of cutList.sheetGoods) {
    const rows = g.rows.filter((r) => !r.byLength);
    if (g.material && rows.length) sheets.push(nestSheetGroup(g.material, { ...g, rows }, options.sheet));
  }
  const { plans, glueUps } = planLumber(cutList.lumber, project.materials, options.lumber, project.units.grid);
  const hardware = estimateHardware(project, results);
  const shopping = buildShoppingList(sheets, { plans, glueUps }, hardware, cutList);
  const issues = rowIssues(project, cutList).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { options, cutList, sheets, lumber: plans, glueUps, hardware, shopping, issues };
}
