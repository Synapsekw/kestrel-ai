import type { ApiClient, Job } from "@contract/client";
import type { Drawing } from "@/api/drawings";
import { autoImportDrawing } from "@/setup/drawingSetup";

/**
 * "Import and include" (plan I1 Ruling 12): import the file as setup does, with no one at the dialog
 * (`autoImportDrawing`). Throws with the reason when the file needs a person's choice or cannot be read.
 */
export async function importDrawingFile(
  api: ApiClient,
  projectId: string,
  path: string,
): Promise<{ drawings: Drawing[]; job: Job }> {
  const out = await autoImportDrawing(api, projectId, path);
  if (out.state === "needs_choice") throw new Error(out.error);
  return { drawings: out.drawings, job: out.job };
}
