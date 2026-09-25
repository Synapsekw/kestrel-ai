import { EmptyState } from "@/ui";

/**
 * Point clouds: import a LAS/LAZ, view it in 3D, measure, link it to a map, export a LAZ (spec
 * 2026-09-23-point-clouds section 8). Lazy-loaded from routes.tsx, so three and potree-core load
 * only here. Foundation F0 lands it empty; S1 units U1, U2 and J1 build it.
 */
export function CloudsScreen() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Point clouds</h1>
      <EmptyState icon="cloud" title="Import a LAS or LAZ point cloud">
        See a drone survey&apos;s point cloud in 3D, measure it and link it to a map of the same flight.
        Importing is not available in this build yet.
      </EmptyState>
    </div>
  );
}
