import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listFindings, type Finding } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { useChangesStore } from "@/store/changes";
import { inspectorState, type InspectorState } from "./inspectorState";
import { useFindingLinks, useSelection } from "./seams";

export const IMAGE_FINDINGS_LIMIT = 500;
export interface InspectorModel {
  state: InspectorState;
  findings: Finding[];
  more: boolean;
  loaded: boolean;
  findingIdOf: (boxId: string) => string | null;
}

/** One page of GET /findings?image_id= per image and per findings.changed (budget), plus the panel state. */
export function useInspectorModel(projectId: string, imageId: string | null): InspectorModel {
  const api = useApi();
  const revision = useChangesStore((s) => s.findingsRevision);
  const { types } = useProjectTypes(projectId);
  const { selectedId, boxes } = useSelection();
  const { findingOf, linkFindings, loaded } = useFindingLinks();
  const [page, setPage] = useState<{ id: string | null; items: Finding[]; more: boolean }>({
    id: null,
    items: [],
    more: false,
  });
  useEffect(() => {
    if (!imageId) return;
    let cancelled = false;
    listFindings(api, projectId, { image_id: imageId, limit: IMAGE_FINDINGS_LIMIT, sort: "-severity" })
      .then((p) => !cancelled && setPage({ id: imageId, items: p.items, more: p.next_cursor !== null }))
      .catch((e: unknown) => pushLog(`findings on image failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, imageId, revision]);
  const items = page.id === imageId ? page.items : [];
  // FC-R16: the box → finding links live in FC's store; this page fills them (FA adds its own accepts).
  // C1: FC's loadImage clears `findingOf`, so link only once FC holds THIS frame, and again after
  // every load of it (`loaded` is a new object per load), whichever of the two reads lands first.
  const frame = loaded?.id === imageId ? loaded : null;
  useEffect(() => {
    if (!frame) return;
    const links: Record<string, string> = {};
    for (const f of items) if (f.anchor.kind === "image") links[f.anchor.annotation_id] = f.id;
    if (Object.keys(links).length) linkFindings(links);
  }, [frame, items, linkFindings]);
  const findingIdOf = useCallback((boxId: string) => findingOf[boxId] ?? null, [findingOf]);
  const state = useMemo(
    () => inspectorState({ selectedId, boxes, findingOf: findingIdOf, types }),
    [selectedId, boxes, findingIdOf, types],
  );
  return {
    state,
    findings: items,
    more: page.id === imageId && page.more,
    loaded: page.id === imageId,
    findingIdOf,
  };
}
