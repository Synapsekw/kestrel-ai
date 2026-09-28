import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type OlMap from "ol/Map";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { listMapFindingsInView } from "@/api/mapFindings";
import { useChangesStore } from "@/store/changes";
import { toast } from "@/ui";
import { useWorkspace, type MapSide, type SiteFrame } from "@/mapws/annotations/bindings";
import { findingMapIds } from "@/mapws/annotations/pick";
import { useMapFindingsStore } from "./store";

export const MOVE_DEBOUNCE_MS = 250;

/**
 * The Findings layer's read (spec §13, W3-13): one `GET /map-workspace/findings` per settled view
 * (moveend debounced 250 ms) and per `findingsRevision`, with the viewport bbox and this pane's maps,
 * ≤ 5 000 pins, into this pane's slot of `useMapFindingsStore`. The previous request is aborted; a
 * local frame reads nothing (spec §14).
 */
export function useFindingsInView(
  map: OlMap,
  opts: { projectId: string; frame: SiteFrame; side: MapSide; allSurveys: boolean },
): void {
  const { projectId, frame, side, allSurveys } = opts;
  const api = useApi();
  const revision = useChangesStore((s) => s.findingsRevision);
  const view = useWorkspace(useShallow((s) => ({ l: s.l, r: s.r, mode: s.mode })));
  const surveys = useWorkspace((s) => s.surveys);
  const [moved, setMoved] = useState(0);
  const local = frame.kind === "local";
  const mapIds = findingMapIds(surveys, view, side).join(",");

  useEffect(() => {
    let timer: number | undefined;
    const onEnd = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMoved((n) => n + 1), MOVE_DEBOUNCE_MS);
    };
    map.on("moveend", onEnd);
    return () => {
      window.clearTimeout(timer);
      map.un("moveend", onEnd);
    };
  }, [map]);

  useEffect(() => {
    if (local || (!allSurveys && mapIds === "")) {
      useMapFindingsStore.getState().setSide(side, [], false);
      return;
    }
    const size = map.getSize();
    if (!size) return;
    const bbox = map
      .getView()
      .calculateExtent(size)
      .map((v) => v.toFixed(2))
      .join(",");
    const ctrl = new AbortController();
    listMapFindingsInView(
      api,
      projectId,
      { bbox, ...(allSurveys ? {} : { map_ids: mapIds.split(",") }) },
      ctrl.signal,
    )
      .then((r) => {
        if (!ctrl.signal.aborted) useMapFindingsStore.getState().setSide(side, r.items, r.truncated);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted && !isNotImplemented(e))
          toast("danger", messageOf(e, "Could not load the findings."));
      });
    return () => ctrl.abort();
  }, [api, projectId, map, side, local, allSurveys, mapIds, revision, moved]);

  // A pane that closes (Side-by-side → Single) takes its pins out of `byId`.
  useEffect(() => () => useMapFindingsStore.getState().clearSide(side), [side]);
}
