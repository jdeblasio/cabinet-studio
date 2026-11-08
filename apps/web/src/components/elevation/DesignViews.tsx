/**
 * The 2D design pane: the editable elevation (of a wall run, or an island's front or back face),
 * or a read-only view from either end or from above, with a switcher and a Walls toggle.
 */
import { useActiveRun, useEditor, type DesignView } from '../../store/store';
import { Elevation } from './Elevation';
import { ProjectionView } from './ProjectionView';

export function DesignViews() {
  const view = useEditor((s) => s.designView);
  return (
    <>
      {view === 'elevation' ? <Elevation /> : <ProjectionView view={view} />}
      <ViewBar />
    </>
  );
}

function ViewBar() {
  const run = useActiveRun();
  const view = useEditor((s) => s.designView);
  const setView = useEditor((s) => s.setDesignView);
  const setActiveRun = useEditor((s) => s.setActiveRun);
  const showWalls = useEditor((s) => s.showWalls);
  const setShowWalls = useEditor((s) => s.setShowWalls);
  const island = run.kind === 'island';
  const mainId = run.islandOf ?? run.id;
  const backId = useEditor((s) => (island ? s.project.runs.find((r) => r.islandOf === mainId)?.id : undefined));

  const face = (which: 'front' | 'back') => {
    const target = which === 'front' ? mainId : backId;
    if (target && target !== run.id) setActiveRun(target);
    setView('elevation');
  };
  const on = (v: DesignView, isBack = false) => view === v && (v !== 'elevation' || !!run.islandOf === isBack);
  const options: [DesignView, string, string][] = [
    ['left', 'Left', 'From the left end (read-only)'],
    ['right', 'Right', 'From the right end (read-only)'],
    ['top', 'Top', 'From above (read-only)'],
  ];
  return (
    <div className="design-views">
      <span className="segmented">
        <button className={on('elevation') ? 'on' : ''} title={island ? "Edit the island's front face" : 'Edit the front elevation'} onClick={() => face('front')}>
          Front
        </button>
        {island && (
          <button
            className={on('elevation', true) ? 'on' : ''}
            disabled={!backId}
            title={backId ? "Edit the island's back face (as seen from the back)" : 'This island has a finished back panel, not back boxes'}
            onClick={() => face('back')}
          >
            Back
          </button>
        )}
        {options.map(([v, label, title]) => (
          <button key={v} className={view === v ? 'on' : ''} title={title} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
      </span>
      {!island && (
        <label className="toggle overlay-toggle" title="Show the wall and ceiling behind the boxes">
          <input type="checkbox" checked={showWalls} onChange={(e) => setShowWalls(e.target.checked)} />
          Walls
        </label>
      )}
    </div>
  );
}
