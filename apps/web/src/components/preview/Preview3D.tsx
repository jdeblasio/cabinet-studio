import { findBox, findSpan, TICKS_PER_INCH, type Id, type Part, type Run, type RunResult, type Ticks } from '@built-in-planner/engine';
import { Edges, OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useState } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import { useRunResult } from '../../store/derived';
import { selectionForId, type Selection } from '../../store/selection';
import { useActiveRun, useEditor, type View3D } from '../../store/store';

/** Scene units are inches. */
const I = (t: Ticks) => t / TICKS_PER_INCH;
const HIGHLIGHT = '#2f6bff';

/** Parts to highlight for the current selection. */
function highlightedParts(run: Run, result: RunResult, selection: Selection | null): Set<Id> {
  const ids = new Set<Id>();
  if (!selection || selection.kind === 'run') return ids;
  if (selection.kind === 'section') {
    const box = result.boxes.find((b) => b.id === selection.ownerId);
    // The selected section and all its descendants.
    const sections = new Set<Id>([selection.sectionId]);
    let grew = true;
    while (grew && box) {
      grew = false;
      for (const s of box.sections) {
        if (s.parentId && sections.has(s.parentId) && !sections.has(s.sectionId)) {
          sections.add(s.sectionId);
          grew = true;
        }
      }
    }
    for (const p of result.parts) {
      const prefix = p.id.split('/')[0]!;
      if (p.ownerId === selection.ownerId && sections.has(prefix)) ids.add(p.id);
    }
    return ids;
  }
  const owners = new Set<Id>();
  if (selection.kind === 'box') owners.add(selection.boxId);
  else if (selection.kind === 'span') owners.add(selection.spanId);
  else if (selection.kind === 'tier') {
    owners.add(selection.tierId);
    const tier = run.tiers.find((t) => t.id === selection.tierId);
    for (const it of tier?.items ?? []) owners.add(it.kind === 'box' ? it.id : it.spanId);
  }
  for (const p of result.parts) if (owners.has(p.ownerId)) ids.add(p.id);
  return ids;
}

export function Preview3D() {
  const run = useActiveRun();
  const result = useRunResult();
  const materials = useEditor((s) => s.project.materials);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const mode = useEditor((s) => s.view3d);
  const setMode = useEditor((s) => s.setView3d);
  const [resetKey, setResetKey] = useState(0);

  const colors = useMemo(() => new Map(materials.map((m) => [m.id, m.color])), [materials]);
  const highlighted = useMemo(() => highlightedParts(run, result, selection), [run, result, selection]);

  const W = Math.max(I(result.width), 12);
  const H = Math.max(I(result.ceilingHeight), 12);
  const size = Math.max(W, H);
  const target: [number, number, number] = [W / 2, H / 2, 8];

  const onSelectPart = (part: Part) => {
    if (findBox(run, part.ownerId) || findSpan(run, part.ownerId) || run.tiers.some((t) => t.id === part.ownerId)) {
      select(selectionForId(run, part.ownerId, result));
    }
  };

  return (
    <div className="preview">
      <Canvas key={`${run.id}:${resetKey}`} camera={{ fov: 35, near: 1, far: size * 20 }} dpr={[1, 2]}>
        <FitCamera width={W} height={H} target={target} />
        <color attach="background" args={['#f3f1ec']} />
        <hemisphereLight intensity={0.85} groundColor="#b8ad9b" />
        <directionalLight position={[W * 0.2, H * 1.6, size * 1.2]} intensity={1.3} />
        <directionalLight position={[W * 1.2, H * 0.5, size * 0.4]} intensity={0.35} />
        {/* Soft fill from below so undersides (bottoms over openings) read as surfaces, not dark recesses. */}
        <directionalLight position={[W * 0.4, -H * 0.8, size * 0.8]} intensity={0.6} />
        {/* Wall and floor */}
        <mesh position={[W / 2, H / 2, -0.26]}>
          <boxGeometry args={[W, H, 0.5]} />
          <meshStandardMaterial color="#e7e3dc" />
        </mesh>
        <mesh position={[W / 2, -0.25, size * 0.3]}>
          <boxGeometry args={[W * 1.3, 0.5, size * 0.6]} />
          <meshStandardMaterial color="#d6d0c6" />
        </mesh>
        <group>
          {result.parts.map((p) => (
            <PartMesh
              key={p.id}
              part={p}
              color={colors.get(p.materialId) ?? '#cccccc'}
              mode={mode}
              highlighted={highlighted.has(p.id)}
              onSelect={onSelectPart}
            />
          ))}
        </group>
        <OrbitControls target={target} makeDefault enableDamping dampingFactor={0.12} />
      </Canvas>
      <div className="preview-controls">
        <span className="segmented">
          {(['shaded', 'wireframe'] as const).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'shaded' ? 'Shaded' : 'Wireframe'}
            </button>
          ))}
        </span>
        <button onClick={() => setResetKey((k) => k + 1)}>Reset view</button>
      </div>
    </div>
  );
}

/** Place the camera so the whole wall fits the canvas (on mount, i.e. per run / reset). */
function FitCamera({ width, height, target }: { width: number; height: number; target: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const controls = useThree((s) => s.controls) as { target: Vector3; update: () => void } | null;
  const [done, setDone] = useState(false);
  // Dev-only handle for inspecting the 3D view (like window.__editor for the store).
  if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__preview3d = { camera, controls };
  useLayoutEffect(() => {
    if (done || !(camera instanceof PerspectiveCamera) || !Number.isFinite(aspect)) return;
    const half = (camera.fov * Math.PI) / 360;
    const dist = Math.max(height / 2 / Math.tan(half), width / 2 / (Math.tan(half) * aspect)) * 1.35;
    const dir = new Vector3(0.38, 0.22, 1).normalize();
    const t = new Vector3(...target);
    camera.position.copy(t.clone().add(dir.multiplyScalar(dist)));
    camera.lookAt(t);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(t);
      controls.update();
      setDone(true);
    }
  }, [camera, aspect, controls, width, height, target, done]);
  return null;
}

const PartMesh = memo(function PartMesh({
  part,
  color,
  mode,
  highlighted,
  onSelect,
}: {
  part: Part;
  color: string;
  mode: View3D;
  highlighted: boolean;
  onSelect: (p: Part) => void;
}) {
  const b = part.bounds;
  const w = Math.max(I(b.width), 0.001);
  const h = Math.max(I(b.height), 0.001);
  const d = Math.max(I(b.depth), 0.001);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 4) return; // the end of an orbit drag, not a click
    onSelect(part);
  };
  return (
    <mesh position={[I(b.x) + w / 2, I(b.y) + h / 2, I(b.z) + d / 2]} onClick={onClick}>
      <boxGeometry args={[w, h, d]} />
      {mode === 'shaded' ? (
        <meshStandardMaterial
          color={color}
          roughness={0.85}
          emissive={highlighted ? HIGHLIGHT : '#000000'}
          emissiveIntensity={highlighted ? 0.35 : 0}
        />
      ) : (
        <meshBasicMaterial color={highlighted ? HIGHLIGHT : color} transparent opacity={highlighted ? 0.25 : 0.05} depthWrite={false} />
      )}
      <Edges threshold={15} color={highlighted ? HIGHLIGHT : mode === 'wireframe' ? '#4d3f2f' : '#6f5e4a'} />
    </mesh>
  );
});
