import { EmptyState } from "@/ui";

/**
 * Volumes: surfaces from point clouds and designs, cut and fill over a polygon (spec
 * 2026-09-23-volumes section 9). Lazy-loaded from routes.tsx. Foundation F0 lands it empty; S2
 * units V7 and V8 build it, and S3 unit U8 mounts "Import design surface" in its surface list.
 */
export function VolumesScreen() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Volumes</h1>
      <EmptyState icon="volume" title="Measure stockpiles and earthworks">
        Build a surface from a point cloud, then measure cut and fill against a toe, a flat level, another
        survey or a design. Volumes are not available in this build yet.
      </EmptyState>
    </div>
  );
}
