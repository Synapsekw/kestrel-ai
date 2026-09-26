import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import type { FindingDetail } from "@/api/findings";
import { fetchLibraryModel } from "@/api/library";
import { Icon } from "@/ui";
import { formatPercent, parseCreatedBy, relativeTime } from "../format";

/** The library model's name; ambiguity 18: "Model m0000000" once the library no longer has it. */
function useModelName(modelId: string | null): string | null {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    fetchLibraryModel(api, modelId)
      .then((m) => {
        if (!cancelled) setLoaded({ id: modelId, name: m.name });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: modelId, name: `Model ${modelId.slice(0, 8)}` });
      });
    return () => {
      cancelled = true;
    };
  }, [api, modelId]);
  return modelId && loaded?.id === modelId ? loaded.name : null;
}

/** F §8.7 item 6 (ws-images .prov): AI provenance on `--grad-ai`; a person's finding gets one plain line. */
export function Provenance({ finding, nowMs }: { finding: FindingDetail; nowMs: number }) {
  const by = parseCreatedBy(finding.created_by);
  const name = useModelName(by.kind === "model" ? by.modelId : null);
  if (by.kind === "human") {
    return <p className="text-xs text-muted">Marked by hand · {relativeTime(finding.created_at, nowMs)}</p>;
  }
  const confidence = formatPercent(finding.confidence);
  return (
    <div className="flex items-center gap-2.5 rounded-control border border-accent/30 bg-grad-ai px-3 py-2.5 text-xs">
      <Icon name="sparkle" size={16} className="shrink-0 text-accent-ink" />
      <div className="min-w-0">
        <p className="font-semibold text-ink">
          {["Created by AI", name ?? "…", confidence].filter(Boolean).join(" · ")}
        </p>
        <p className="text-2xs text-muted">
          {finding.reviewed_at ? `Accepted ${relativeTime(finding.reviewed_at, nowMs)}` : "Awaiting review"}
        </p>
      </div>
    </div>
  );
}
