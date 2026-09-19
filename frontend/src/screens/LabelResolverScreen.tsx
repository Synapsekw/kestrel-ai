import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchImagePage, IMAGE_PAGE_SIZE } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { DEFAULT_QUERY, toImageParams } from "@/data/listModel";
import { useNavigationStore } from "@/store/navigation";
import { Skeleton } from "@/ui";

/**
 * The "Label" step of the sidebar: opens the first image that still needs labels, with the
 * unlabeled images as the editor's Next / Previous walk. With nothing left it goes to Images with
 * a notice; with no images at all it goes to Images plainly.
 */
export function LabelResolverScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const unlabeled = toImageParams(
      { ...DEFAULT_QUERY, filters: { ...DEFAULT_QUERY.filters, labeled: "no" } },
      IMAGE_PAGE_SIZE,
    );
    const go = (to: string) => {
      if (!cancelled) void navigate(to, { replace: true });
    };
    fetchImagePage(api, projectId, unlabeled)
      .then(async (page) => {
        if (cancelled) return;
        if (page.items.length > 0) {
          const ids = page.items.map((i) => i.id);
          useNavigationStore.getState().setContext(ids, "data", `/p/${projectId}/data`);
          go(`/p/${projectId}/edit/${ids[0]}`);
          return;
        }
        const any = await fetchImagePage(api, projectId, toImageParams(DEFAULT_QUERY, 1));
        go(any.items.length > 0 ? `/p/${projectId}/data?notice=all-labeled` : `/p/${projectId}/data`);
      })
      .catch((e: unknown) => {
        pushLog(`label resolver failed: ${messageOf(e, String(e))}`);
        go(`/p/${projectId}/data`);
      });
    return () => {
      cancelled = true;
    };
  }, [api, navigate, projectId]);

  return (
    <div role="status" aria-label="Opening the next image to label" className="flex flex-col gap-3">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="mt-4 h-64 w-full rounded-lg" />
    </div>
  );
}
