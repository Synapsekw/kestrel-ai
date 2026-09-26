import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { listDataItems } from "@/api/dataItems";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

/** One Data list page is enough to name every item of a real project (F §6.3). */
export const DATA_LABELS_LIMIT = 200;
const EMPTY: ReadonlyMap<string, string> = new Map();

export function useDataLabels(projectId: string): ReadonlyMap<string, string> {
  const api = useApi();
  const revision = useChangesStore((s) => s.dataRevision);
  const [loaded, setLoaded] = useState<{ projectId: string; labels: ReadonlyMap<string, string> } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    listDataItems(api, projectId, { limit: DATA_LABELS_LIMIT })
      .then((page) => {
        if (!cancelled) setLoaded({ projectId, labels: new Map(page.items.map((d) => [d.id, d.label])) });
      })
      .catch((e: unknown) => pushLog(`data list unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, revision]);
  return loaded?.projectId === projectId ? loaded.labels : EMPTY;
}
