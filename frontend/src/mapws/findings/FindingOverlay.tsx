import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApi } from "@/api/client";
import { formatFindingNumber } from "@/findings/format";
import { useChangesStore } from "@/store/changes";
import { toast } from "@/ui";
import {
  completedCoords,
  useGoneLayers,
  useSiteLayers,
  useTools,
  useWorkspace,
  type ToolOverlayProps,
} from "@/mapws/annotations/bindings";
import { PointPopover } from "@/mapws/annotations/PointPopover";
import {
  anchorMapFor,
  anchorPoint,
  createMapFinding,
  findingFailure,
  isFindingRefusal,
  type FindingShape,
} from "./actions";
import { FindingTypePicker } from "./FindingTypePicker";
import { usePulseStore } from "./pulse";

/** Spec §5.1 `M`/`G`: W1's finished point or polygon → the type picker → F's create (§9.4). */
function FindingOverlay({ shape, projectId }: ToolOverlayProps & { shape: FindingShape }) {
  const toolId = shape === "point" ? "finding-point" : "finding-polygon";
  const api = useApi();
  const completed = useTools((s) => (s.completed?.toolId === toolId ? s.completed : null));
  const clearCompleted = useTools((s) => s.clearCompleted);
  const viewApi = useWorkspace((s) => s.viewApi);
  const r = useWorkspace((s) => s.r);
  const select = useWorkspace((s) => s.select);
  const visibility = useWorkspace(useShallow((s) => ({ layerState: s.layerState, order: s.order })));
  const gone = useGoneLayers((s) => s.gone);
  const layers = useSiteLayers();
  const [busy, setBusy] = useState(false);
  const refused = useRef<object | null>(null);

  const coords = useMemo(() => (completed ? completedCoords(completed.geometry) : null), [completed]);
  const picked = useMemo(
    () => (coords ? anchorMapFor(layers, { ...visibility, gone }, r, shape, coords) : null),
    [coords, layers, visibility, gone, r, shape],
  );

  // Review Focus 3: no ortho of the right date under the click → the refusal, nothing is sent.
  useEffect(() => {
    if (!picked || !("refusal" in picked) || refused.current === picked) return;
    refused.current = picked;
    toast("info", picked.refusal);
    clearCompleted();
  }, [picked, clearCompleted]);

  if (!coords || !picked || !("mapId" in picked)) return null;
  const { mapId } = picked;

  async function pick(typeId: string) {
    if (!coords || busy) return;
    setBusy(true);
    try {
      const f = await createMapFinding(api, projectId, { shape, coords, mapId, typeId });
      // A create keeps its trailing bump: the id is unknown before the answer (Global Constraints §1).
      useChangesStore.getState().bumpFindings();
      usePulseStore.getState().pulse(f.id);
      select({ kind: "finding", id: f.id }); // W3-10: the tool stays active
      toast("ok", `${formatFindingNumber(f.number)} added`);
    } catch (e) {
      toast(isFindingRefusal(e) ? "info" : "danger", findingFailure(e));
    } finally {
      setBusy(false);
      clearCompleted();
    }
  }

  const px = viewApi?.pixelOf(anchorPoint(shape, coords)) ?? null;
  if (!px) return null;
  return (
    <PointPopover px={px} label="Finding type" onClose={clearCompleted}>
      {busy ? (
        <p className="w-[280px] p-3 text-sm text-muted">Adding the finding…</p>
      ) : (
        <FindingTypePicker projectId={projectId} onPick={(id) => void pick(id)} />
      )}
    </PointPopover>
  );
}

export function FindingPointOverlay(props: ToolOverlayProps) {
  return <FindingOverlay {...props} shape="point" />;
}

export function FindingPolygonOverlay(props: ToolOverlayProps) {
  return <FindingOverlay {...props} shape="polygon" />;
}
