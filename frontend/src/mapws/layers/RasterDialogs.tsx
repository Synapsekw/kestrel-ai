import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/api/client";
import { deleteMap } from "@/api/maps";
import { updateMapDate } from "@/api/sources";
import { deleteSurface } from "@/api/surfaces";
import { RunDialog } from "@/runs/RunDialog";
import { bumpWorkspaceData } from "../data/useRasterLayers";
import { evaluateHref } from "../links";
import type { PanelProps } from "../panels/panelRegistry";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { updateSurfaceDateRole } from "./elevationApi";
import { useRasterActions } from "./rasterMenu";
import { elevationRoleOf } from "./rasterRows";
import { SurveyDateDialog } from "./SurveyDateDialog";

/** Runs what a W2 row menu asked for; the dialogs portal to `body`, so the stage slot is fine. */
export function RasterDialogs({ projectId }: PanelProps) {
  const api = useApi();
  const navigate = useNavigate();
  const action = useRasterActions((s) => s.current);
  const clear = useRasterActions((s) => s.clear);

  useEffect(() => {
    if (action?.type !== "evaluate") return;
    clear();
    navigate(evaluateHref(projectId, action.row.id));
  }, [action, clear, navigate, projectId]);

  if (!action || action.type === "evaluate") return null;
  const { row } = action;
  const layer = row.layer;
  const surface = row.kind === "surface";

  if (action.type === "run") {
    return <RunDialog projectId={projectId} initialSourceIds={[row.id]} onClose={clear} onStarted={clear} />;
  }
  if (action.type === "date") {
    return (
      <SurveyDateDialog
        title={surface ? `Date and role of ${row.name}` : `Survey date of ${layer?.name ?? row.name}`}
        initial={layer && !layer.date_is_import_date ? layer.date : null}
        role={surface && layer ? (elevationRoleOf(layer) ?? "dsm") : undefined}
        onSave={async (date, role) => {
          if (surface) await updateSurfaceDateRole(api, projectId, row.id, date, role ?? "dsm");
          else await updateMapDate(api, projectId, row.id, date);
          bumpWorkspaceData(surface);
        }}
        onClose={clear}
      />
    );
  }
  return (
    <ConfirmDeleteDialog
      title={`Delete ${layer?.name ?? row.name}?`}
      body={
        surface
          ? "The surface and its folder are deleted. A volume that uses it must be deleted first."
          : "Its runs, zones and labels are deleted with it. The original file stays where it is."
      }
      onConfirm={async () => {
        if (surface) await deleteSurface(api, projectId, row.id);
        else await deleteMap(api, projectId, row.id);
        bumpWorkspaceData(surface);
      }}
      onClose={clear}
    />
  );
}
