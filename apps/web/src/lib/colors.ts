import { finishesOf } from '@cabinet-studio/engine';
import { useMemo } from 'react';
import { useEditor } from '../store/store';

/** Display color for a part: its paint or finish if it has one, else its material's color. */
export function usePartColor(): (part: { materialId: string; finishId?: string }) => string {
  const materials = useEditor((s) => s.project.materials);
  const finishes = useEditor((s) => s.project.finishes);
  return useMemo(() => {
    const byMaterial = new Map(materials.map((m) => [m.id, m.color]));
    const byFinish = new Map(finishesOf({ finishes }).map((f) => [f.id, f.color]));
    return (p) => (p.finishId ? byFinish.get(p.finishId) : undefined) ?? byMaterial.get(p.materialId) ?? '#cccccc';
  }, [materials, finishes]);
}
