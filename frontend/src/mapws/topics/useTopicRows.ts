import { useMemo } from "react";
import { useWorkspace } from "../context";
import { layerRegistry, type LayerRow } from "../layers/layerRegistry";
import { effectiveState } from "../layers/placement";
import type { MapTopicId } from "./topicIds";

/** The annotation row kinds each topic's header eye drives (spec §4 "Eye"). */
export const TOPIC_KINDS: Record<MapTopicId, readonly string[]> = {
  layers: [],
  findings: ["findings", "zones"],
  measure: ["measurements", "volumes"],
  ai: ["detections"],
  drawings: [],
};

export interface TopicVisibility {
  value: boolean;
  /** Every row of the topic is visible (a creation tool needs its own row on, ruling R7). */
  all: boolean;
  toggle(): void;
  /** Turns every row of the topic on (a creation tool of a hidden topic was picked). */
  show(): void;
}

/** The header eye (spec §4 "Eye"): on when any of the topic's rows is visible; toggles them together. */
export function useTopicVisibility(rows: readonly LayerRow[], topic: MapTopicId): TopicVisibility {
  const own = useMemo(() => rows.filter((r) => TOPIC_KINDS[topic].includes(r.kind)), [rows, topic]);
  const layerState = useWorkspace((s) => s.layerState);
  const setLayerState = useWorkspace((s) => s.setLayerState);
  const shown = own.map((r) => effectiveState(r, layerRegistry.get(r.kind), layerState).visible);
  const value = shown.some(Boolean);
  return {
    value,
    all: shown.every(Boolean),
    toggle: () => own.forEach((r) => setLayerState(r.key, { visible: !value })),
    show: () => own.forEach((r) => setLayerState(r.key, { visible: true })),
  };
}

/** One annotation row's filter controls, wired to its persisted style (as LayerRowView does). */
export function useRowStyle(rows: readonly LayerRow[], kind: string) {
  const row = rows.find((r) => r.kind === kind);
  const state = useWorkspace((s) => (row ? s.layerState[row.key] : undefined));
  const setLayerState = useWorkspace((s) => s.setLayerState);
  const style = useMemo(() => state?.style ?? {}, [state]);
  return {
    row,
    style,
    setStyle: (patch: Record<string, unknown>) => {
      if (row) setLayerState(row.key, { style: { ...style, ...patch } });
    },
  };
}
