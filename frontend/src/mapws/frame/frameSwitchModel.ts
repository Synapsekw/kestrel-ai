import type { ApiClient, components } from "@contract/client";
import { unwrap } from "@/api/errors";
import type { FrameItemCounts } from "../state/workspaceStore";

type S = components["schemas"];

/**
 * `PUT /map-workspace/frame` (setSiteFrame). `{kind: "crs"}` without an epsg lets the server pick the
 * site CRS by rule M3 (422 `invalid_epsg` while nothing has coordinates).
 */
export async function setSiteFrame(
  api: ApiClient,
  projectId: string,
  body: S["SiteFrameSet"],
): Promise<void> {
  await unwrap(
    api.PUT("/api/v1/projects/{projectId}/map-workspace/frame", { params: { path: { projectId } }, body }),
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Spec M §6: "Local metres · 2 surfaces" in a CRS frame (local items are surfaces only), "Site CRS ·
 * 4 items" in the local one.
 */
export function frameSwitchLabel(kind: "crs" | "local", items: FrameItemCounts): string {
  return kind === "local"
    ? `Site CRS · ${count(items.crs, "item", "items")}`
    : `Local metres · ${count(items.local, "surface", "surfaces")}`;
}
