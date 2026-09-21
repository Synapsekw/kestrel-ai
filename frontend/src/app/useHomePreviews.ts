import { useEffect, useState } from "react";
import type { Image } from "@contract/client";
import { useApi } from "@/api/client";

/** Decorative previews get one bounded metadata page; failure never blocks Home. */
export function useHomePreviews(projectId: string): Image[] {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ projectId: string; items: Image[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api
      .GET("/api/v1/projects/{projectId}/images", {
        params: { path: { projectId }, query: { limit: 3, sort: "created_at", order: "desc" } },
      })
      .then(({ data }) => {
        if (!cancelled) setLoaded({ projectId, items: data?.items.slice(0, 3) ?? [] });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ projectId, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return loaded?.projectId === projectId ? loaded.items : [];
}
