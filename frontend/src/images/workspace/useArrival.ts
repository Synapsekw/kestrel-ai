import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { fetchFinding } from "@/api/findings";
import { useReducedMotion } from "@/ui";
import { ARRIVAL_KEYS, hasArrivalKeys, parseArrival, stripKeys, withinImage } from "./arrival";
import { useArrivalStore } from "./arrivalStore";
import { shapeBounds } from "./panTo";
import { useImagesWorkspace, useSelection } from "./seams";

export interface ArrivalOptions {
  projectId: string;
  imageId: string | null;
  width: number;
  height: number;
  /** The frame's size, its annotations and the canvas viewport are known. */
  ready: boolean;
  onOpenInspector: () => void;
}

/** §6.5: handles ?finding= and ?at=&r=&from=cloud: once per arrival, then drops them with replace. */
export function useArrival(o: ArrivalOptions): void {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selection = useSelection();
  const reduced = useReducedMotion();
  const latest = useRef({ o, selection, reduced });
  useEffect(() => {
    latest.current = { o, selection, reduced };
  });
  const handled = useRef<string | null>(null);
  const search = params.toString();

  useEffect(() => {
    useArrivalStore.getState().leave(o.imageId);
  }, [o.imageId]);

  useEffect(() => {
    const imageId = o.imageId;
    if (!imageId || !o.ready) return;
    const q = new URLSearchParams(search);
    if (!hasArrivalKeys(q)) return;
    const key = `${imageId}?${search}`;
    if (handled.current === key) return;
    handled.current = key;
    const drop = () => setParams((prev) => stripKeys(prev, ARRIVAL_KEYS), { replace: true });
    const arrival = parseArrival(q);
    if (!arrival) return drop();
    if (arrival.kind === "point") {
      const { o: opts } = latest.current;
      if (withinImage(arrival, opts.width, opts.height)) {
        // Ruling 7: FC centres (px, py) and sizes the r circle to a third of the shorter side; no animation on arrival.
        useImagesWorkspace
          .getState()
          .centreOn({ x: arrival.px, y: arrival.py }, { radiusPx: arrival.r, animate: false });
        useArrivalStore
          .getState()
          .arrive(imageId, { px: arrival.px, py: arrival.py, r: arrival.r }, arrival.cloudId);
      }
      return drop();
    }
    if (arrival.kind === "back") {
      // Amendment (IMC reconciliation item 9): a photo found by distance with no pixel — offer
      // Back to 3D, but never centre and never draw a ring.
      useArrivalStore.getState().arrive(imageId, null, arrival.cloudId);
      return drop();
    }
    // I2: until the finding is in, this arrival is not handled: a cleanup (StrictMode's double
    // effect, a dep change) forgets the key, so the next run of the same key fetches again.
    let live = true;
    let settled = false;
    fetchFinding(api, o.projectId, arrival.findingId)
      .then((f) => {
        settled = true;
        if (!live) return;
        const a = f.anchor;
        if (a.kind !== "image") return drop();
        if (a.image_id !== imageId) {
          void navigate(`/p/${o.projectId}/images/${a.image_id}?finding=${encodeURIComponent(f.id)}`, {
            replace: true,
          });
          return;
        }
        const { selection: s, reduced: r, o: opts } = latest.current;
        s.select(a.annotation_id);
        const box = s.boxes[a.annotation_id];
        if (box) useImagesWorkspace.getState().panIntoView(shapeBounds(box), { animate: !r });
        opts.onOpenInspector();
        drop();
      })
      .catch(() => {
        settled = true;
        if (live) drop();
      });
    return () => {
      live = false;
      if (!settled && handled.current === key) handled.current = null;
    };
  }, [api, navigate, o.projectId, o.imageId, o.ready, search, setParams]);
}
