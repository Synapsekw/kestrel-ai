import { useState } from "react";
import { Button } from "@/ui";
import { ImportDesignDialog } from "./ImportDesignDialog";

/**
 * "Import design surface" next to S2's "Build surface" (spec 2026-09-23-design-surfaces §11).
 *
 * Reloads only when an import starts (`onStarted`, so the new "building" surface appears at once)
 * — S2's `surfaces.changed` websocket handling (Volumes spec §11.3, already wired in
 * `VolumesScreen`) reloads the list again once the backend finishes building it. This deliberately
 * does not use `useOnJobsFinished("design_import", …)`: the dialog's inspect and preview steps
 * share that same job type, so a type-wide "finished" listener here would reload the list on every
 * step of the wizard, not just on a completed import (Task 6 review, ruling (d)).
 */
export function ImportDesignButton({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon="import" onClick={() => setOpen(true)}>
        Import design surface
      </Button>
      {open && (
        <ImportDesignDialog
          projectId={projectId}
          onClose={() => setOpen(false)}
          onStarted={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}
