import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listActivity, type Activity } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useNow } from "@/jobs/useNow";
import { useChangesStore } from "@/store/changes";
import { relativeTime } from "../format";

/** The newest history rows read per finding (a bounded read). */
const HISTORY_LIMIT = 20;

/** F §8.7 item 10: the activity feed filtered to this finding. */
export function History({ projectId, findingId }: { projectId: string; findingId: string }) {
  const api = useApi();
  const nowMs = useNow(60_000);
  const revision = useChangesStore((s) => s.findingsRevision);
  const [loaded, setLoaded] = useState<{ id: string; items: Activity[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    listActivity(api, projectId, { subject_id: findingId, limit: HISTORY_LIMIT })
      .then((page) => {
        if (!cancelled) setLoaded({ id: findingId, items: page.items });
      })
      .catch((e: unknown) => pushLog(`history unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, findingId, revision]);
  const items = loaded?.id === findingId ? loaded.items : [];
  if (items.length === 0) return <p className="text-xs text-muted">No history yet.</p>;
  return (
    <ol className="flex flex-col gap-2 text-xs">
      {items.map((a) => (
        <li key={a.id} className="flex items-baseline justify-between gap-3">
          <span className="text-ink">{a.summary}</span>
          <span className="shrink-0 text-dim">{relativeTime(a.at, nowMs)}</span>
        </li>
      ))}
    </ol>
  );
}
