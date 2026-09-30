import { useEffect, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchOverviewSite, type OverviewSite } from "@/api/overview";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { BURST_DEBOUNCE_MS } from "./useOverview";

/** Read after `/overview` has landed (`ready`), never gating it; a failure just drops the location pane. */
export function useOverviewSite(
  projectId: string,
  ready: boolean,
): { site: OverviewSite | null; settled: boolean } {
  const api = useApi();
  const dataRev = useChangesStore((s) => s.dataRevision);
  const [state, setState] = useState<{ key: string; site: OverviewSite | null } | null>(null);
  const key = `${projectId}|${dataRev}`;
  const readFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    // The first read is immediate; a burst of data changes collapses into one re-read (as useOverview).
    const delay = readFor.current === projectId ? BURST_DEBOUNCE_MS : 0;
    const timer = window.setTimeout(() => {
      readFor.current = projectId;
      fetchOverviewSite(api, projectId)
        .then((site) => live && setState({ key, site }))
        .catch((e: unknown) => {
          pushLog(`site location unavailable: ${messageOf(e, String(e))}`);
          if (live) setState({ key, site: null });
        });
    }, delay);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [api, projectId, ready, key]);
  // A read for another project is never shown; a data change keeps the last site until the re-read lands.
  const mine = state !== null && state.key.startsWith(`${projectId}|`);
  return { site: mine ? state.site : null, settled: mine };
}
