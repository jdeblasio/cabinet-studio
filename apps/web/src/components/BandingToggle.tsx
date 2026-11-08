import { useEditor } from '../store/store';

/** Color for highlighted edge banding (stands out against wood tones and the blue selection). */
export const BANDING_COLOR = '#d4237a';
/** Color for exposed raw plywood edges (not banded, not covered). */
export const RAW_EDGE_COLOR = '#f08c00';

/** "Edges" highlight toggle, shared by the elevation and the 3D preview: banded and exposed raw edges. */
export function BandingToggle() {
  const on = useEditor((s) => s.showBanding);
  const set = useEditor((s) => s.setShowBanding);
  return (
    <label
      className="toggle overlay-toggle"
      title="Highlight edge-banded edges, and plywood edges left exposed without banding (see Edge banding and Band exposed edges under Construction). In the 3D view, Wireframe shows the ones behind doors."
    >
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span className="banding-swatch" style={{ background: BANDING_COLOR }} aria-hidden />
      Banded
      <span className="banding-swatch" style={{ background: RAW_EDGE_COLOR }} aria-hidden />
      Raw edges
    </label>
  );
}
