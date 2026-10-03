import type { ApiClient } from "@contract/client";
import {
  createDrawing,
  createDrawingPages,
  createDrawingInspection,
  getDrawingInspection,
  type DrawingInspection,
} from "@/api/drawings";
import { autoImportRequest } from "@/mapws/drawings/drawingImport";
import { useJobsStore } from "@/store/jobs";
import type { StartOutcome } from "./importPlan";

/** How setup waits on a drawing's inspect job (one small JSON read per interval); tests swap `sleep`. */
export const drawingWait = {
  intervalMs: 1000,
  /** A drawing still being read after this long is left to Add data. */
  maxMs: 10 * 60_000,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/** Polls an inspection (one small JSON read per drawingWait.intervalMs) until it is read or drawingWait.maxMs passes. */
export async function settledInspection(
  api: ApiClient,
  projectId: string,
  inspectionId: string,
): Promise<DrawingInspection> {
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
  const insp = await settledInspection(api, projectId, inspection.id);
  if (insp.state === "failed") throw new Error(insp.error ?? "reading the drawing failed; choose it again");
  if (insp.state === "inspecting")
    return {
      state: "needs_choice",
      error: "The drawing is still being read. Finish its import from Add data.",
    };
  const request = autoImportRequest(insp);
  if (request.kind === "error") return { state: "needs_choice", error: request.error };
  const built =
    request.kind === "pages"
      ? await createDrawingPages(api, projectId, request.body)
      : await createDrawing(api, projectId, request.body);
  useJobsStore.getState().upsert(built.job);
  return { state: "started", jobId: built.job.id };
}
