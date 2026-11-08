import { createDefaultProject } from '@built-in-planner/engine';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useEditor, type EditorState } from '../../store/store';
import { BuildView } from './BuildView';

/** Server rendering reads the store's initial state, so set both. */
function setBoth(patch: Partial<EditorState>) {
  useEditor.setState(patch);
  Object.assign(useEditor.getInitialState(), patch);
}

describe('build steps view', () => {
  it('renders numbered steps by section, with parts tables and checkboxes', () => {
    const project = createDefaultProject();
    setBoth({ project, activeRunId: project.runs[0]!.id, loaded: true });
    const html = renderToStaticMarkup(<BuildView />);
    expect(html).toContain('<h1>Build steps</h1>');
    for (const title of ['Before you start', 'Cut and prepare the parts', 'Base (tier 1 of 2, from the bottom)', 'Upper (tier 2 of 2, from the bottom)', 'Finish']) expect(html).toContain(title);
    expect(html).toContain('Build Base 1, 2, 3 and 4 (4 identical boxes)');
    expect(html).toContain('class="build-num">1<');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('build-parts');
    expect(html).toContain('@page { size: portrait');
  });
});
