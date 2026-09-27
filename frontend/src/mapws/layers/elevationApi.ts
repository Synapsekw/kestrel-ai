import type { ApiClient } from "@contract/client";
import { unwrap } from "@/api/errors";

/** M §5.2 "set date and role" for a plain DSM/DTM import (`dem`); needs M-C0's SurfacePatch fields. */
export async function updateSurfaceDateRole(
  api: ApiClient,
  projectId: string,
  surfaceId: string,
  capturedOn: string | null,
  role: "dsm" | "dtm",
): Promise<void> {
  await unwrap(
    api.PATCH("/api/v1/projects/{projectId}/surfaces/{surfaceId}", {
      params: { path: { projectId, surfaceId } },
      body: { captured_on: capturedOn, elevation_role: role },
    }),
  );
}
