import type { ApiClient } from "@contract/client";
import { unwrap } from "@/api/errors";

/** What the backend writes as a comment's author while no name is set (BC `comments.DEFAULT_AUTHOR`). */
export const DEFAULT_OPERATOR_NAME = "Operator";
export const MAX_OPERATOR_NAME = 80;

/** The name on the operator's comments (F §5.3, §8.1 `author`), kept in the backend's settings.json. */
export async function fetchOperatorName(api: ApiClient): Promise<string | null> {
  const r = await unwrap(api.GET("/api/v1/settings/operator"));
  return r.operator_name;
}

/** Saves a trimmed name (blank clears it) and returns the name now stored, or null. */
export async function saveOperatorName(api: ApiClient, name: string): Promise<string | null> {
  const clean = name.trim().slice(0, MAX_OPERATOR_NAME);
  const r = await unwrap(api.PUT("/api/v1/settings/operator", { body: { operator_name: clean || null } }));
  return r.operator_name;
}
