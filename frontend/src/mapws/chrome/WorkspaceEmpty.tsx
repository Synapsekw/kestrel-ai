import { AddDataButton } from "@/data/AddDataButton";
import { EmptyState, GlassPanel } from "@/ui";

/** Spec §14 / R-W1-16: no georeferenced data in the project yet. */
export function WorkspaceEmpty({ projectId }: { projectId: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <GlassPanel
        variant="float"
        radius="panel"
        className="pointer-events-auto w-[440px] max-w-[calc(100%-32px)] px-4"
      >
        <EmptyState
          icon="map"
          title="No georeferenced data yet"
          action={
            <>
              <AddDataButton projectId={projectId} tile="orthomosaic" variant="primary" icon="plus">
                Import an orthomosaic
              </AddDataButton>
              <AddDataButton projectId={projectId} tile="elevation" icon="elevation">
                Import elevation
              </AddDataButton>
              <AddDataButton projectId={projectId} icon="drawing">
                Import drawing
              </AddDataButton>
            </>
          }
        >
          Orthomosaics, elevation models and drawings with coordinates line up here on one site map.
        </EmptyState>
      </GlassPanel>
    </div>
  );
}
