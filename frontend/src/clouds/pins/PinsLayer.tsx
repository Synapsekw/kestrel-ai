import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { ClassDef, CloudClipBox } from "@contract/client";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { insideClipBox, type ClipBox } from "@/clouds/viewer/clipBox";
import { setPinsProbe } from "@/clouds/viewer/diagnostics";
import type { Vec3 } from "@/clouds/viewer/types";
import { useSeverityScale } from "@/ui";
import { PinsLayerController } from "./pinsController";
import { toPinView } from "./pinView";
import type { PinClip } from "./project";
import { DRAFT_ID, type CloudPin, type DraftPin, type PinView } from "./types";
import "./pins.css";

export const DRAFT_COLOUR = "rgb(var(--accent))";

export interface PinsLayerProps {
  viewer: RefObject<CloudViewerHandle | null>;
  pins: readonly CloudPin[];
  types: ReadonlyMap<string, ClassDef>;
  draft: DraftPin | null;
  /** A finding id, or `DRAFT_ID` while the draft callout is open. */
  selectedId: string | null;
  /** The operator's clip box (W1's `ctx.clipBox`). */
  clipBox: CloudClipBox | null;
  /** The callout host element in W1's floating layer; the controller positions it. */
  calloutEl: HTMLElement | null;
  onSelect: (id: string) => void;
}

const v3 = (a: readonly number[]): Vec3 => [a[0], a[1], a[2]];

/**
 * The operator's box as X1's classifier predicate (float64, exact; V2 Ruling 4). The
 * `CloudClipBox` → `ClipBox` shape conversion is a small local copy of the one W1 already has in
 * `workspace/clipEngine.ts` (private there); not worth exporting for one call site (ruling T5-4).
 */
export function toPinClip(c: CloudClipBox | null): PinClip | null {
  if (!c) return null;
  const box: ClipBox = { centre: v3(c.centre), size: v3(c.size), yawDeg: c.yaw_deg };
  return { mode: c.mode, contains: (p) => insideClipBox(p as Vec3, box) };
}

/**
 * One occlusion call over the shown pins. `occlusion()` answers `null` while the camera is
 * moving, while no engine exists yet, or while a C-V2 view capture is running; in every case the
 * flags are left alone (ruling T5-5).
 */
export function runOcclusion(viewer: Pick<CloudViewerHandle, "occlusion">, ctl: PinsLayerController): void {
  const t = ctl.occlusionTargets();
  if (t.ids.length === 0) return;
  const res = viewer.occlusion(t.points, t.tol);
  if (res) ctl.applyOcclusion(t.ids, res);
}

/**
 * Spec §9.2: the HTML pins over the canvas (W1's z 5 layer); it also places the callout host.
 *
 * No `hidden` prop / `setSuspended` here (ruling T5-2): W1 only mounts this layer (and the
 * floating layer that carries the callout) while `ctx.viewState === "running"`, so a "view lost"
 * state can never be observed by a mounted `PinsLayer` — there is nothing to hide.
 */
export function PinsLayer({
  viewer,
  pins,
  types,
  draft,
  selectedId,
  clipBox,
  calloutEl,
  onSelect,
}: PinsLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctlRef = useRef<PinsLayerController | null>(null);
  const onSelectRef = useRef(onSelect);
  const scale = useSeverityScale();

  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  useLayoutEffect(() => {
    const ctl = new PinsLayerController(hostRef.current!, (id) => onSelectRef.current(id));
    ctlRef.current = ctl;
    setPinsProbe(() => ctl.snapshot());
    return () => {
      setPinsProbe(null);
      ctl.dispose();
      ctlRef.current = null;
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    const ctl = ctlRef.current;
    if (!v || !ctl) return;
    const offFrame = v.onFrame((cam) => ctl.frame(cam));
    const offSettle = v.onSettle(() => runOcclusion(v, ctl));
    // A layer mounted onto an already-idle view gets no frame until something else renders one
    // (hand-off); ask for exactly one, never from the settle listener above (ruling T5-3).
    v.requestRender();
    return () => {
      offFrame();
      offSettle();
    };
  }, [viewer]);

  const views = useMemo<PinView[]>(() => {
    const list = pins.map((p) => toPinView(p, scale, types));
    if (draft)
      list.push({
        id: DRAFT_ID,
        p: draft.p,
        normal: draft.normal,
        u: draft.u,
        colour: DRAFT_COLOUR,
        label: "New finding",
        ariaLabel: "New finding (not saved)",
        draft: true,
      });
    return list;
  }, [pins, draft, scale, types]);

  useEffect(() => {
    const ctl = ctlRef.current;
    if (!ctl) return;
    const changed = ctl.setPins(views);
    // Pins that arrived or moved (Move pin → refetch) while the view is settled get their
    // occlusion now: no settle is coming for them otherwise (review fix round 1).
    if (changed.length > 0 && viewer.current) runOcclusion(viewer.current, ctl);
  }, [views, viewer]);

  useEffect(() => ctlRef.current?.setClip(toPinClip(clipBox)), [clipBox]);
  useEffect(() => ctlRef.current?.setSelected(selectedId), [selectedId]);

  useEffect(() => {
    const ctl = ctlRef.current;
    if (!ctl) return;
    ctl.attachCallout(calloutEl);
    if (!calloutEl) return;
    ctl.setCalloutHeight(calloutEl.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => ctlRef.current?.setCalloutHeight(calloutEl.offsetHeight));
    ro.observe(calloutEl);
    return () => ro.disconnect();
  }, [calloutEl]);

  return <div ref={hostRef} className="kp-pins" data-testid="cloud-pins" />;
}
