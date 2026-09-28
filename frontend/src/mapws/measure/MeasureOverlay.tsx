import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApi } from "@/api/client";
import { toast } from "@/ui";
import {
  bumpMapMeasurements,
  completedCoords,
  useGoneLayers,
  useSiteLayers,
  useTools,
  useWorkspace,
  type Completed,
  type ToolOverlayProps,
} from "@/mapws/annotations/bindings";
import { FloatLabel } from "@/mapws/annotations/FloatLabel";
import { liveLabel, type MeasureKind } from "@/mapws/annotations/format";
import { MeasureRefusal, createFailure, createMeasurement } from "./actions";

/** Mounted by W1 while the tool is active: the live label, then the save of W1's `completed` line. */
function MeasureOverlay({ kind, projectId, frame }: ToolOverlayProps & { kind: MeasureKind }) {
  const api = useApi();
  const completed = useTools((s) => (s.completed?.toolId === kind ? s.completed : null));
  const draft = useTools((s) => s.draft);
  const clearCompleted = useTools((s) => s.clearCompleted);
  const pointer = useWorkspace((s) => s.pointer);
  const viewApi = useWorkspace((s) => s.viewApi);
  const select = useWorkspace((s) => s.select);
  const view = useWorkspace(useShallow((s) => ({ l: s.l, r: s.r, mode: s.mode })));
  const visibility = useWorkspace(useShallow((s) => ({ layerState: s.layerState, order: s.order })));
  const gone = useGoneLayers((s) => s.gone);
  const layers = useSiteLayers();
  const [busy, setBusy] = useState(false);
  const handled = useRef<Completed | null>(null);

  useEffect(() => {
    if (!completed || handled.current === completed) return;
    handled.current = completed;
    setBusy(true);
    createMeasurement(api, projectId, kind, completedCoords(completed.geometry), {
      view,
      layers,
      shown: { ...visibility, gone },
    })
      .then((m) => {
        bumpMapMeasurements();
        select({ kind: "measurement", id: m.id }); // W3-10: the tool stays active
      })
      .catch((e: unknown) => toast(e instanceof MeasureRefusal ? "info" : "danger", createFailure(e)))
      .finally(() => {
        setBusy(false);
        clearCompleted();
      });
  }, [completed, api, projectId, kind, view, layers, visibility, gone, select, clearCompleted]);

  const drawn = pointer ? [...draft, pointer] : draft;
  const text = busy ? "Measuring…" : liveLabel(kind, drawn, frame.kind);
  const at = drawn[drawn.length - 1];
  const px = at && viewApi ? viewApi.pixelOf([at[0], at[1]]) : null;
  if (!text || !px) return null;
  return <FloatLabel px={px} text={text} />;
}

export function DistanceOverlay(props: ToolOverlayProps) {
  return <MeasureOverlay {...props} kind="distance" />;
}

export function AreaOverlay(props: ToolOverlayProps) {
  return <MeasureOverlay {...props} kind="area" />;
}

export function ProfileOverlay(props: ToolOverlayProps) {
  return <MeasureOverlay {...props} kind="profile" />;
}
