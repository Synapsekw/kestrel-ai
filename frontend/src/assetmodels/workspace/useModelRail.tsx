import { useState, type ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { ModelView } from "@/assetmodels/viewer/engine";
import { createRailStore, TopicPanel, type RailState, type RailTopic } from "@/ui";
import { MODEL_TOPICS, type ModelTopicId } from "./topics";
import { ViewToolButtons, type ViewToolState } from "./ViewTools";

/** Opens a topic; on the topic already open it stays open (the store's openTopic would close it). */
export function showTopic(store: StoreApi<RailState>, id: ModelTopicId): void {
  const s = store.getState();
  if (!s.open || s.topic !== id) s.openTopic(id);
}

/**
 * The asset workspace rail (workspace-rail spec §2): M1's view tools as navigation, then the Model,
 * Findings and Photos topics. One store per mount; the open topic is remembered. The Findings
 * button shows no badge: a badge is for items waiting on the operator, and findings are not.
 */
export function useModelRail(p: {
  running: boolean;
  tools: ViewToolState;
  onToggle(t: keyof ViewToolState): void;
  onView(v: ModelView): void;
  modelBody: ReactNode;
  findingsBody: ReactNode;
  photosBody: ReactNode;
}): { store: StoreApi<RailState>; topics: RailTopic[]; nav: ReactNode } {
  const [store] = useState(() => createRailStore("models", MODEL_TOPICS, "model"));
  const nav = (
    <ViewToolButtons state={p.tools} disabled={!p.running} onToggle={p.onToggle} onView={p.onView} />
  );
  const topics: RailTopic[] = [
    {
      id: "model",
      label: "Model",
      // not "cube": the Views tool above already wears it; the topic plays the clouds Layers role
      icon: "layers",
      group: "shared",
      body: <TopicPanel title="Model">{p.modelBody}</TopicPanel>,
    },
    { id: "findings", label: "Findings", icon: "findings", group: "shared", body: p.findingsBody },
    { id: "photos", label: "Photos", icon: "camera", group: "workspace", body: p.photosBody },
  ];
  return { store, topics, nav };
}
