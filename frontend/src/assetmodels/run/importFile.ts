import type { ApiClient, Job } from "@contract/client";
import { createDrawing, createDrawingInspection, createDrawingPages, type Drawing } from "@/api/drawings";
import { autoImportRequest } from "@/mapws/drawings/drawingImport";
import { settledInspection } from "@/setup/drawingSetup";
import { useJobsStore } from "@/store/jobs";

/**
 * "Import and include" (plan I1 Ruling 12): read the file, then import it as Add data would with no
 * one at the dialog: every page of a PDF in one job, any other file with the dialog's defaults.
 * Throws with the reason when the file needs a person's choice or cannot be read.
 */
export async function importDrawingFile(
  api: ApiClient,
  projectId: string,
  path: string,
): Promise<{ drawings: Drawing[]; job: Job }> {
  const { inspection, job: inspectJob } = await createDrawingInspection(api, projectId, path);
  useJobsStore.getState().upsert(inspectJob);
  const insp = await settledInspection(api, projectId, inspection.id);
  if (insp.state === "failed") throw new Error(insp.error ?? "Reading the drawing failed.");
  if (insp.state === "inspecting") throw new Error("The file is still being read. Try again in a minute.");
  const request = autoImportRequest(insp);
  if (request.kind === "error") throw new Error(`${request.error} Import it from Add data.`);
  if (request.kind === "pages") {
    const r = await createDrawingPages(api, projectId, request.body);
    return { drawings: r.drawings, job: r.job };
  }
  const r = await createDrawing(api, projectId, request.body);
  return { drawings: [r.drawing], job: r.job };
}
