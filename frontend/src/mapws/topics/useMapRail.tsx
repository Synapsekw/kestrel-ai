import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import { createRailStore, ToolButton, type RailState, type RailTopic } from "@/ui";
import { useTools } from "../context";
import { useRegistry } from "../registry";
import { shortcutFor, toolRegistry, toolsOfTopic } from "../tools/toolStore";
import { AiTopic } from "./AiTopic";
import { DrawingsTopic } from "./DrawingsTopic";
import { FindingsTopic } from "./FindingsTopic";
import { LayersTopic } from "./LayersTopic";
import { MeasureTopic } from "./MeasureTopic";
import { MAP_TOPICS, type MapTopicId } from "./topicIds";
import type { MapTopicProps } from "./types";
import { usePendingCount } from "./usePendingCount";
import { useTopicVisibility, type TopicVisibility } from "./useTopicRows";

/** The map rail (spec §2): Select and Pan on the rail, then the five topics. One store per mount. */
export function useMapRail(p: MapTopicProps & { hasBaseData: boolean }): {
  store: StoreApi<RailState>;
  topics: RailTopic[];
  nav: ReactNode;
} {
  const { rows, notInCompare, projectId, context, hasBaseData } = p;
  const [store] = useState(() => createRailStore("maps", MAP_TOPICS, hasBaseData ? "findings" : "layers"));
  const registry = useRegistry(toolRegistry);
  const active = useTools((s) => s.active);
  const activate = useTools((s) => s.activate);
  const findings = useTopicVisibility(rows, "findings");
  const measure = useTopicVisibility(rows, "measure");
  const ai = useTopicVisibility(rows, "ai");
  const pending = usePendingCount();

  // Spec §4 "Tool keys": the open panel follows the armed tool; a hidden topic comes back on.
  useEffect(() => {
    const topic = registry.find((t) => t.id === active)?.topic;
    if (!topic || topic === "nav") return;
    store.getState().revealTopicFor(topic);
    const eyes: Partial<Record<MapTopicId, TopicVisibility>> = { findings, measure, ai };
    const vis = eyes[topic];
    if (vis && !vis.value) vis.show();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the armed tool only
  }, [active]);

  const nav = toolsOfTopic(registry, "nav").map((t) => (
    <ToolButton
      key={t.id}
      icon={t.icon}
      label={t.label}
      shortcut={shortcutFor(t.action)}
      active={active === t.id}
      onClick={() => activate(t.id)}
    />
  ));

  const topics = useMemo<RailTopic[]>(() => {
    const props: MapTopicProps = { rows, notInCompare, projectId, context };
    return [
      { id: "layers", label: "Layers", icon: "layers", group: "shared", body: <LayersTopic {...props} /> },
      {
        id: "findings",
        label: "Findings",
        icon: "findings",
        group: "shared",
        hidden: !findings.value,
        body: <FindingsTopic {...props} />,
      },
      {
        id: "measure",
        label: "Measure",
        icon: "measure",
        group: "shared",
        hidden: !measure.value,
        body: <MeasureTopic {...props} />,
      },
      {
        id: "ai",
        label: "AI",
        icon: "detect",
        group: "workspace",
        badge: pending,
        hidden: !ai.value,
        body: <AiTopic {...props} />,
      },
      {
        id: "drawings",
        label: "Drawings",
        icon: "drawing",
        group: "workspace",
        body: <DrawingsTopic {...props} />,
      },
    ];
  }, [rows, notInCompare, projectId, context, findings.value, measure.value, ai.value, pending]);

  return { store, topics, nav };
}
