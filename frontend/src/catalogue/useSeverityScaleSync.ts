import { useEffect } from "react";
import { useApi } from "@/api/client";
import { fetchSeverityScale } from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useCatalogueSeverity } from "./severityStore";

/**
 * Loads the catalogue's scale into `useCatalogueSeverity`: on boot and on every `catalogue.changed`.
 * A failure keeps the last scale (DS's default before the first answer) and is logged.
 */
export function useSeverityScaleSync(): void {
  const api = useApi();
  const revision = useChangesStore((s) => s.catalogueRevision);
  useEffect(() => {
    let cancelled = false;
    fetchSeverityScale(api)
      .then((levels) => {
        if (!cancelled) useCatalogueSeverity.getState().setLevels(levels);
      })
      .catch((e: unknown) => pushLog(`load severity scale failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, revision]);
}
