import type { ApiClient, MigrationState } from "@contract/client";
import { unwrap } from "./errors";

/** Runs a failed project upgrade again (202): the answer is the project's new migration state, whose
 * `job_id` names the `project_migrate` job on the library runner. */
export function retryMigration(api: ApiClient, folder: string): Promise<MigrationState> {
  return unwrap(api.POST("/api/v1/projects/migrations/retry", { body: { folder } }));
}

/** Opens Explorer on the pre-upgrade backup of the project in `folder` (the backend starts it). */
export async function revealProjectBackup(api: ApiClient, folder: string): Promise<void> {
  await unwrap(api.POST("/api/v1/projects/migrations/reveal-backup", { body: { folder } }));
}
