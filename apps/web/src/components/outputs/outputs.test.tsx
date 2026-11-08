import { createDefaultProject, DEFAULT_COUNTERTOP, DEFAULT_CUTLIST_OPTIONS, inches, opening, type Project } from '@built-in-planner/engine';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../../store/store';
import { CutListView } from './CutListView';
import { SheetsView } from './SheetsView';
import { ShoppingView } from './ShoppingView';
import { cutOptionsOf, getCutReport, resetCutOptions, setCutOptions, useCutOptions } from './state';

/**
 * Server rendering reads a zustand store's initial state (its server snapshot), so tests update
 * the initial state object too.
 */
function setBoth<T extends object>(store: { getState: () => T; setState: (p: Partial<T>) => void; getInitialState: () => T }, patch: Partial<T>) {
  store.setState(patch);
  Object.assign(store.getInitialState(), patch);
}

function load(project: Project) {
  useEditor.getState().replaceProject(project);
  setBoth(useEditor, { project, loaded: true });
}

/** One 146" box: top, bottom and rails are longer than a sheet or a 12' board. */
function wideBox(): Project {
  const p = createDefaultProject();
  const run = p.runs[0]!;
  run.wall[0]!.length = inches(147);
  const base = run.tiers[0]!;
  base.items = [{ kind: 'box', id: 'wide', width: { kind: 'fixed', size: inches(146) }, content: opening({ type: 'drawer' }) }];
  base.countertop = { ...DEFAULT_COUNTERTOP };
  run.tiers = [base];
  return p;
}

describe('output views', () => {
  beforeEach(() => {
    setBoth(useCutOptions, { showCutOrder: false });
  });

  it('render the default project', () => {
    load(createDefaultProject());
    const cut = renderToStaticMarkup(<CutListView />);
    expect(cut).toContain('Cut list');
    expect(cut).toContain('Download CSV');
    expect(cut).toContain('Sheet goods');
    expect(cut).toContain('Lumber');
    expect(cut).toContain('Base 1');
    const sheets = renderToStaticMarkup(<SheetsView />);
    expect(sheets).toContain('Sheet 1 of');
    expect(sheets).toContain('<svg');
    expect(sheets).toContain('lb-board');
    expect(sheets).toContain('Stock lengths');
    const shop = renderToStaticMarkup(<ShoppingView />);
    expect(shop).toContain('Hinges');
    expect(shop).toContain('Shelf pins');
    expect(shop).toContain('Board feet');
  });

  it('show parts that fit no sheet or board', () => {
    load(wideBox());
    const sheets = renderToStaticMarkup(<SheetsView />);
    expect(sheets).toContain('Not placed');
    expect(sheets).toContain('Longer than any stock board');
    expect(sheets).toContain('Glue-ups');
    const cut = renderToStaticMarkup(<CutListView />);
    expect(cut).toContain('144 9/16&quot;');
    expect(cut).toContain('Doesn&#x27;t fit a 96&quot; × 48&quot; sheet');
    const shop = renderToStaticMarkup(<ShoppingView />);
    expect(shop).toContain('not covered');
    expect(shop).toContain('Drawer slides');
  });

  it('draw the cut order when asked', () => {
    load(createDefaultProject());
    setBoth(useCutOptions, { showCutOrder: true });
    expect(renderToStaticMarkup(<SheetsView />)).toContain('sheet-cut');
  });

  it('render an empty project', () => {
    const p = createDefaultProject();
    p.runs[0]!.tiers = [];
    load(p);
    expect(renderToStaticMarkup(<CutListView />)).toContain('No parts yet');
    expect(renderToStaticMarkup(<SheetsView />)).toContain('No parts yet');
    expect(renderToStaticMarkup(<ShoppingView />)).toContain('Nothing to buy yet');
  });

  it('memoize the report per project snapshot and options', () => {
    load(createDefaultProject());
    const p = useEditor.getState().project;
    const o = cutOptionsOf(p);
    expect(o).toBe(DEFAULT_CUTLIST_OPTIONS);
    expect(getCutReport(p, o)).toBe(getCutReport(p, o));
    // Options are saved with the project (undoable) as overrides of the defaults.
    setCutOptions({ sheet: { kerf: inches(1 / 16) } });
    const p2 = useEditor.getState().project;
    expect(p2.cutList).toEqual({ sheet: { kerf: inches(1 / 16) } });
    const o2 = cutOptionsOf(p2);
    expect(o2.sheet.kerf).toBe(inches(1 / 16));
    expect(o2.lumber).toEqual(o.lumber);
    expect(cutOptionsOf(p2)).toBe(o2);
    expect(getCutReport(p2, o2)).not.toBe(getCutReport(p, o));
    resetCutOptions();
    expect(useEditor.getState().project.cutList).toBeUndefined();
  });
});
