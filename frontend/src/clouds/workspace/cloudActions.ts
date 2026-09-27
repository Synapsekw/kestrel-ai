import type { NavigateFunction } from "react-router-dom";
import type { ApiClient } from "@contract/client";
import { createPointCloud, deletePointCloud, patchPointCloud, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";
import { toast } from "@/ui";

export function report(action: string, err: unknown): string {
  const message = messageOf(err, `could not ${action}`);
  pushLog(`${action} failed: ${message}`);
  toast("danger", message);
  return message;
}

/** The ready cloud to open when none is named (plan Ruling 2). */
export function defaultCloud(clouds: readonly PointCloud[]): PointCloud {
  return clouds.find((c) => c.status === "ready") ?? clouds[0];
}

/**
 * S1's retry of a failed import: it keeps the map link (create links it) and the capture date
 * (create has no field for it); a failed date or delete is said, never undoes the new import.
 */
export function importAgain(
  api: ApiClient,
  projectId: string,
  c: PointCloud,
  navigate: NavigateFunction,
  reload: () => void,
): void {
  void createPointCloud(api, projectId, {
    path: c.source_path,
    name: c.name,
    ...(c.map_id ? { map_id: c.map_id } : {}),
  })
    .then(
      async (r) => {
        useJobsStore.getState().upsert(r.job);
        navigate(`/p/${projectId}/clouds/${r.cloud.id}`);
        if (c.captured_on)
          await patchPointCloud(api, projectId, r.cloud.id, { captured_on: c.captured_on }).catch(
            (e: unknown) => void report("keep the capture date", e),
          );
        await deletePointCloud(api, projectId, c.id).catch(
          (e: unknown) => void report("remove the failed point cloud", e),
        );
      },
      (e: unknown) => void report("import again", e),
    )
    .finally(reload);
}
