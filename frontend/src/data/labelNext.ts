import type { ApiClient } from "@contract/client";
import { messageOf } from "@/api/errors";
import { fetchImagePage, IMAGE_PAGE_SIZE } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { useNavigationStore } from "@/store/navigation";
import { DEFAULT_QUERY, toImageParams } from "./listModel";

export type LabelNext = { imageId: string } | "all-labeled" | "no-images";

/**
 * The Images tab's "Label next" (was the Label step): the first image that still needs labels,
 * with the unlabeled page as the editor's Next / Previous walk. One bounded page.
 */
export async function labelNext(api: ApiClient, projectId: string): Promise<LabelNext> {
  const unlabeled = toImageParams(
    { ...DEFAULT_QUERY, filters: { ...DEFAULT_QUERY.filters, labeled: "no" } },
    IMAGE_PAGE_SIZE,
  );
  try {
    const page = await fetchImagePage(api, projectId, unlabeled);
    if (page.items.length > 0) {
      const ids = page.items.map((i) => i.id);
      useNavigationStore.getState().setContext(ids, "data", `/p/${projectId}/images`);
      return { imageId: ids[0] };
    }
    const any = await fetchImagePage(api, projectId, toImageParams(DEFAULT_QUERY, 1));
    return any.items.length > 0 ? "all-labeled" : "no-images";
  } catch (e) {
    pushLog(`label next failed: ${messageOf(e, String(e))}`);
    return "no-images";
  }
}
