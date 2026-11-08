import { addIsland, createDefaultProject } from '@cabinet-studio/engine';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useEditor, type EditorState } from '../../store/store';
import { DesignViews } from './DesignViews';

/** Server rendering reads the store's initial state, so set both. */
function setBoth(patch: Partial<EditorState>) {
  useEditor.setState(patch);
  Object.assign(useEditor.getInitialState(), patch);
}

describe('design views', () => {
  it('offer Front, Back, Left, Right and Top for an island, with no Walls toggle', () => {
    const project = createDefaultProject();
    const id = addIsland(project);
    setBoth({ project, activeRunId: id, loaded: true, designView: 'top' });
    const html = renderToStaticMarkup(<DesignViews />);
    for (const label of ['Front', 'Back', 'Left', 'Right', 'Top']) expect(html).toContain(`>${label}</button>`);
    expect(html).not.toContain('Walls');
    expect(html).toContain('From above');
    expect(html).toContain('countertop-outline');
  });

  it('offer a Walls toggle for a wall run, and draw its wall from the end', () => {
    const project = createDefaultProject();
    setBoth({ project, activeRunId: project.runs[0]!.id, loaded: true, designView: 'left', showWalls: true });
    const html = renderToStaticMarkup(<DesignViews />);
    expect(html).toContain('Walls');
    expect(html).not.toContain('>Back</button>');
    expect(html).toContain('section-wall');
  });
});
