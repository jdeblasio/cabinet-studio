import { createDefaultProject } from '@cabinet-studio/engine';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useEditor, type EditorState } from '../../store/store';
import { Inspector } from '../inspector/Inspector';
import { ProjectView } from './ProjectView';

/** Server rendering reads the store's initial state, so set both. */
function setBoth(patch: Partial<EditorState>) {
  useEditor.setState(patch);
  Object.assign(useEditor.getInitialState(), patch);
}

describe('project tab', () => {
  const project = createDefaultProject();
  setBoth({ project, activeRunId: project.runs[0]!.id, selection: null, loaded: true, showAllSettings: false });

  it('holds the project-wide settings', () => {
    const html = renderToStaticMarkup(<ProjectView />);
    for (const title of ['Project', 'Materials', 'Paints and finishes', 'Styles', 'Hardware', 'Construction defaults']) expect(html).toContain(`<h3>${title}</h3>`);
    // Every default is listed (no "show all" toggle at the project level).
    expect(html).not.toContain('settings-toggle');
  });

  it('leaves them out of the design inspector, which lists only overrides', () => {
    const html = renderToStaticMarkup(<Inspector />);
    expect(html).toContain('<h3>Wall run</h3>');
    expect(html).toContain('<h3>Construction (run)</h3>');
    for (const title of ['Materials', 'Styles', 'Hardware', 'Construction defaults']) expect(html).not.toContain(`<h3>${title}</h3>`);
    expect(html).toContain('Everything is inherited from the project.');
    expect(html).toContain('Show all');
    expect(html).toContain('Project tab');
  });
});
