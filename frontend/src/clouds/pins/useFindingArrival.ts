import { useEffect, useRef, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import { fetchFinding, type Finding } from "@/api/findings";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { parseFinding } from "@/clouds/jump";
import { findingHref } from "@/findings/links";
import { toast } from "@/ui";
import { flyToPin } from "./flyTo";
import type { CloudPinsState } from "./useCloudPins";

/** Copy of `clouds/useJumpArrival.ts`'s tick budget (100 ms / 30 s); kept local, not exported from there. */
export const ARRIVAL_TICK_MS = 100;
/** 30 s for the viewer's code and the first points (useJumpArrival's budget). */
export const ARRIVAL_MAX_TICKS = 300;

export interface FindingArrivalOptions {
  projectId: string;
  routeCloudId: string | undefined;
  search: string;
  viewer: RefObject<CloudViewerHandle | null>;
  pins: CloudPinsState;
  /** Select the finding (Findings tab + callout); `finding` lets the caller draw a pin the capped list lacks. */
  onArrive: (id: string, finding: Finding) => void;
}

/**
 * Spec §10.4 "finding → cloud" (F's uniform deep link): once per navigation, read the finding; if its
 * anchor names another cloud (or is not a cloud anchor) replace the URL with the right workspace;
 * otherwise select it at once and, when the cloud shows points, fly to its stored view (else 20 m
 * from the anchor).
 */
export function useFindingArrival({
  projectId,
  routeCloudId,
  search,
  viewer,
  pins,
  onArrive,
}: FindingArrivalOptions): void {
  const api = useApi();
  const navigate = useNavigate();
  const findingId = parseFinding(new URLSearchParams(search));
  const pinsRef = useRef(pins);
  const onArriveRef = useRef(onArrive);
  useEffect(() => {
    pinsRef.current = pins;
    onArriveRef.current = onArrive;
  });

  useEffect(() => {
    if (!findingId || !routeCloudId) return;
    let cancelled = false;
    let timer = 0;
    fetchFinding(api, projectId, findingId)
      .then((f) => {
        if (cancelled) return;
        const a = f.anchor;
        if (a.kind !== "cloud") {
          void navigate(findingHref(projectId, f), { replace: true });
          return;
        }
        if (a.cloud_id !== routeCloudId) {
          void navigate(`/p/${projectId}/clouds/${a.cloud_id}?finding=${encodeURIComponent(findingId)}`, {
            replace: true,
          });
          return;
        }
        onArriveRef.current(findingId, f);
        // T9-3: same first gate as `useJumpArrival` (numVisiblePoints > 0), not a real "cloud ready" signal.
        let ticks = 0;
        timer = window.setInterval(() => {
          ticks += 1;
          const v = viewer.current;
          if (ticks > ARRIVAL_MAX_TICKS) {
            window.clearInterval(timer);
            return;
          }
          if (!v || pinsRef.current.status === "loading" || v.stats().numVisiblePoints === 0) return;
          window.clearInterval(timer);
          // T9-1: flyToPin takes a point (T8-4), not a CloudPin — no cast needed.
          flyToPin(v, [a.x, a.y, a.z], pinsRef.current.views.get(findingId));
        }, ARRIVAL_TICK_MS);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (codeOf(e) === "not_found") toast("info", "This finding no longer exists");
        else toast("danger", messageOf(e, "could not open the finding"));
      });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // once per navigation: the finding id and the route's cloud decide
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectId, routeCloudId, findingId]);
}
