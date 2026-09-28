import { useState } from "react";
import { useBackend } from "@/api/client";
import { view3dUrl } from "@/api/cloudViews";
import { Button, Pill, Skeleton } from "@/ui";
import type { ViewSubject } from "../workspace/seams";
import { subjectKey, useViewStore } from "./viewStore";

/**
 * The stored report view of one cloud finding or measurement (spec §9.4, §11): a 240 × 150
 * thumbnail of what the report prints, a "stale" pill, and Capture / Refresh. Rendered by C-P1's
 * anchor slot and C-M1's Measurements tab through the workspace seam.
 */
export function ReportViewCard({ subject }: { subject: ViewSubject }) {
  const { baseUrl, token } = useBackend();
  const key = subjectKey(subject);
  const loaded = useViewStore((s) => s.views !== null);
  const view = useViewStore((s) => s.views?.[key] ?? null);
  const busy = useViewStore((s) => Boolean(s.busy[key]));
  const ready = useViewStore((s) => s.ready);
  const enqueue = useViewStore((s) => s.actions?.enqueue ?? null);
  const projectId = useViewStore((s) => s.projectId);
  const cloudId = useViewStore((s) => s.cloudId);
  const [brokenSha, setBrokenSha] = useState<string | null>(null);

  const shown = view && view.sha256 !== brokenSha ? view : null;
  const state = !loaded ? "loading" : shown ? "ready" : "empty";
  const incomplete = shown !== null && !shown.render.complete;
  const label = !shown ? "Capture" : incomplete ? "Refresh" : "Refresh view";

  return (
    <section aria-label="Report view" className="flex flex-col gap-2">
      <div
        data-state={state}
        className="relative aspect-[16/10] w-60 overflow-hidden rounded-sm bg-surface-2"
      >
        {state === "loading" && <Skeleton className="h-full w-full" />}
        {state === "ready" && shown && projectId && cloudId && (
          <img
            src={view3dUrl(baseUrl, token, projectId, cloudId, subject, shown.sha256)}
            alt="Report view"
            loading="lazy"
            decoding="async"
            onError={() => setBrokenSha(shown.sha256)}
            className="h-full w-full object-cover"
          />
        )}
        {state === "empty" && (
          <div className="grid h-full place-items-center text-xs text-muted">No report view</div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-surface text-xs text-ink">
            Saving view…
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {shown?.stale && (
          <Pill tone="warn" size="sm">
            stale
          </Pill>
        )}
        {incomplete && <span className="text-xs text-muted">saved before the view finished loading</span>}
        <Button
          size="sm"
          variant={shown ? "ghost" : "secondary"}
          icon="refresh"
          loading={busy}
          disabled={busy || !ready || enqueue === null}
          onClick={() => enqueue?.(subject, shown ? "refresh" : "missing")}
        >
          {label}
        </Button>
      </div>
    </section>
  );
}
