import { AddDataButton } from "@/data/AddDataButton";
import { GlassPanel } from "@/ui";

const UNLOCKS: [string, string][] = [
  ["Photos", "location, detection and findings"],
  ["Orthomosaic", "the site map with finding pins"],
  ["Point cloud", "the 3D view and volumes"],
  ["Findings", "reports"],
];

/** Spec 2026-09-30-project-landing state 4: an empty project asks for data instead of showing empty tiles. */
export function FirstData({ projectId }: { projectId: string }) {
  return (
    <div className="grid h-full min-h-[420px] gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid place-items-center rounded-panel border border-accent/40 bg-accent/5 p-8 text-center">
        <div className="flex max-w-md flex-col items-center gap-3">
          <h2 className="text-xl font-semibold text-ink">Add the first survey</h2>
          <p className="text-sm text-muted">
            A folder of drone photos, a GeoTIFF orthomosaic or a LAS/LAZ point cloud. Each import runs in the
            background, and this page fills in as it lands.
          </p>
          <AddDataButton projectId={projectId} variant="primary" icon="plus">
            Add data
          </AddDataButton>
        </div>
      </div>
      <GlassPanel variant="pane" className="flex flex-col justify-center gap-3 p-6">
        <h3 className="text-xs text-muted">What each kind of data unlocks</h3>
        <ol className="flex flex-col gap-2.5">
          {UNLOCKS.map(([what, unlocks], i) => (
            <li key={what} className="flex items-center gap-3 text-sm text-muted">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 font-mono text-2xs text-ink">
                {i + 1}
              </span>
              <span>
                <span className="text-ink">{what}</span> → {unlocks}
              </span>
            </li>
          ))}
        </ol>
      </GlassPanel>
    </div>
  );
}
