import { useEditor, type AppView } from '../store/store';

const TABS: readonly (readonly [AppView, string, string])[] = [
  ['design', 'Design', 'Edit the built-in: elevation, inspector and 3D preview'],
  ['project', 'Project', 'Project-wide settings: units, materials, hardware, styles and construction defaults'],
  ['cutlist', 'Cut list', 'Every part to cut, grouped by material and size'],
  ['sheets', 'Sheet layouts', 'How the parts nest on sheets and boards'],
  ['shopping', 'Shopping list', 'Sheets, lumber and hardware to buy (quantities only)'],
  ['drawings', 'Drawings', 'Printable elevations, plan, sections and box sheets'],
];

/** Switch between the design editor and the outputs derived from it. */
export function ViewTabs() {
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  return (
    <nav className="view-tabs" aria-label="Views">
      {TABS.map(([id, label, title]) => (
        <button key={id} className={view === id ? 'on' : ''} title={title} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}
