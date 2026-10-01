import type { ApiClient } from "@contract/client";
import {
  createDrawing,
  createDrawingInspection,
  getDrawingInspection,
  type DrawingInspection,
} from "@/api/drawings";
import {
  familyOf,
  initialDrawingForm,
  toDrawingRequest,
  type DrawingRequest,
} from "@/mapws/drawings/drawingImport";
import { useJobsStore } from "@/store/jobs";
import type { StartOutcome } from "./importPlan";

/** How setup waits on a drawing's inspect job (one small JSON read per interval); tests swap `sleep`. */
export const drawingWait = {
  intervalMs: 1000,
  /** A drawing still being read after this long is left to Add data. */
  maxMs: 10 * 60_000,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/**
 * The build request the Add data dialog would send if the operator pressed Import at once (plan
 * ruling U6-1). A PDF with more than one page needs the operator to choose the page.
 */
export function autoDrawingRequest(insp: DrawingInspection): DrawingRequest {
  const pages = insp.page_count ?? insp.pages.length;
  if (familyOf(insp.format) === "pdf" && pages > 1)
    return { ok: false, error: `This PDF has ${pages} pages. Choose the page to import.` };
  return toDrawingRequest(insp, initialDrawingForm(insp));
}

async function settled(api: ApiClient, projectId: string, inspectionId: string): Promise<DrawingInspection> {
  let waited = 0;
  for (;;) {
    const insp = await getDrawingInspection(api, projectId, inspectionId);
    if (insp.state !== "inspecting" || waited >= drawingWait.maxMs) return insp;
    await drawingWait.sleep(drawingWait.intervalMs);
    waited += drawingWait.intervalMs;
  }
}

/**
 * Spec §7.4 "drawing: inspect then build": starts the inspect job, waits for it, then queues the
 * build with the dialog's defaults. Throws when a request fails or the file cannot be read;
 * answers `needs_choice` when a person has to decide (Finish drawing import in the setup notice).
 */
export async function startDrawing(api: ApiClient, projectId: string, path: string): Promise<StartOutcome> {
  const { inspection, job } = await createDrawingInspection(api, projectId, path);
  useJobsStore.getState().upsert(job);
  const insp = await settled(api, projectId, inspection.id);
  if (insp.state === "failed") throw new Error(insp.error ?? "reading the drawing failed; choose it again");
  if (insp.state === "inspecting")
    return {
      state: "needs_choice",
      error: "The drawing is still being read. Finish its import from Add data.",
    };
  const request = autoDrawingRequest(insp);
  if (!request.ok) return { state: "needs_choice", error: request.error };
  const built = await createDrawing(api, projectId, request.body);
  useJobsStore.getState().upsert(built.job);
  return { state: "started", jobId: built.job.id };
}
