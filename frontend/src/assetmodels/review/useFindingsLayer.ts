// src/assetmodels/review/useFindingsLayer.ts
// The findings layer (spec §9 Findings): the model's findings (paged 500, filtered on the server)
// and its placements index (paged 2,000), pushed into the viewer as pins and patches. Patch
// binaries load only when visible (U1 PatchLoader). Lives in the workspace, not in the topic.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AssetModel } from "@contract/client";
import { fetchPatchBuffers, useAssetFindings, usePlacements } from "@/api/assetReview";
import { useBackend } from "@/api/client";
import type { Finding } from "@/api/findings";
import type { ModelViewerHandle } from "@/assetmodels/viewer/ModelViewer";
import { placementItems, type PlacementItem } from "@/assetmodels/viewer/placements";
import { tokenRgb } from "@/clouds/viewer/overlay";
import { useSeverityScale } from "@/ui";
import { NO_FILTER, findingsQuery, focusSettingsOf, isFiltered, type FindingsFilter } from "./findingRows";

export interface FindingsLayer {
  findings: Finding[];
  done: boolean;
  error: string | null;
  reload(): void;
  placedCount: number;
  filter: FindingsFilter;
  setFilter(f: FindingsFilter): void;
  selectedId: string | null;
  select(id: string | null): void;
  focus(id: string): boolean;
  push(): void;
}

const sameItems = (a: readonly PlacementItem[], b: readonly PlacementItem[]) =>
  a === b ||
  (a.length === b.length &&
    a.every((p, i) => p.sightingId === b[i]?.sightingId && p.colour === b[i]?.colour));

export function useFindingsLayer(o: {
  projectId: string;
  model: AssetModel;
  viewer: RefObject<ModelViewerHandle | null>;
}): FindingsLayer {
  const { projectId, model, viewer } = o;
  const backend = useBackend();
  const scale = useSeverityScale();
  const [filter, setFilter] = useState<FindingsFilter>(NO_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useMemo(() => findingsQuery(filter), [filter]);
  const findings = useAssetFindings(projectId, model.id, query);
  const placements = usePlacements(projectId, model.id);
  const fetchPatch = useMemo(
    () => fetchPatchBuffers({ baseUrl: backend.baseUrl, token: backend.token }, projectId, model.id),
    [backend.baseUrl, backend.token, projectId, model.id],
  );
  const fallback = useMemo(() => `rgb(${tokenRgb("muted").join(", ")})`, []);
  const items = useMemo(() => {
    const all = placementItems(placements.items, scale, fallback);
    if (!isFiltered(filter)) return all;
    const listed = new Set(findings.items.map((f) => f.id));
    return all.filter((p) => p.findingId !== null && listed.has(p.findingId));
  }, [placements.items, scale, fallback, filter, findings.items]);

  // Every setPlacements call drops the loaded patches, so it goes once the paged lists are complete
  // and only when the list changed; never once per page or mid filter change.
  const done = findings.done && placements.done;
  const sent = useRef<{ items: readonly PlacementItem[]; fetchPatch: unknown } | null>(null);
  useEffect(() => {
    const v = viewer.current;
    if (!done || !v) return;
    const s = sent.current;
    if (s && s.fetchPatch === fetchPatch && sameItems(s.items, items)) return;
    sent.current = { items, fetchPatch };
    v.setPlacements(items, fetchPatch);
  }, [viewer, done, items, fetchPatch]);

  // A fresh viewer (after a reload) needs the list again, whatever was sent before.
  const push = () => {
    const v = viewer.current;
    if (!v) return;
    sent.current = { items, fetchPatch };
    v.setPlacements(items, fetchPatch);
  };

  const review = model.review ?? null;
  const focus = (id: string) => viewer.current?.focusFinding(id, focusSettingsOf(review)) ?? false;

  return {
    findings: findings.items,
    done: findings.done,
    error: findings.error ?? placements.error,
    reload: () => {
      findings.reload();
      placements.reload();
    },
    placedCount: new Set(items.map((i) => i.findingId)).size,
    filter,
    setFilter,
    selectedId,
    select: setSelectedId,
    focus,
    push,
  };
}
