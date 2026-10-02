import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import {
  createRailStore,
  MenuButton,
  TopicPanel,
  ToolButton,
  type RailState,
  type RailTopic,
  type TopicTool,
} from "@/ui";
import type { ComposedFeatures } from "./compose";
import { InspectorShowsContext, type InspectorShows } from "./inspectorShows";
import type { TopicContent } from "./types";
import { PALETTE, type CloudToolId } from "./tools";
import { CLOUD_TOPICS, TOPIC_OF_TOOL, type CloudTopicId } from "./topics";

const toolsOf = (topic: CloudTopicId | "nav") => PALETTE.flat().filter((e) => TOPIC_OF_TOOL[e.id] === topic);

/**
 * The point cloud rail (workspace-rail spec §2/§3.2): Orbit, Pan and Fly on the rail, then Layers,
 * Findings, Measure, Clip and Photos. One store per mount; the open panel follows the armed tool.
 */
export function useCloudRail(p: {
  active: CloudToolId;
  arm(id: CloudToolId): void;
  isAvailable(id: CloudToolId): boolean;
  /** The view is up, so `isAvailable` is settled (the engine's clip support is known). */
  ready: boolean;
  features: ComposedFeatures;
  layersBody: ReactNode;
  clipBody: ReactNode;
  photosBody: ReactNode;
}): { store: StoreApi<RailState>; topics: RailTopic[]; nav: ReactNode; detail: ReactNode | null } {
  const [store] = useState(() => createRailStore("clouds", CLOUD_TOPICS, "findings"));
  const topic = useStore(store, (s) => s.topic);
  const canClip = p.isAvailable("clip");

  // Spec §3.2 (ruling R9): without engine clipping the Clip topic is hidden; a remembered Clip
  // topic falls back to the default so the rail still shows a panel.
  useEffect(() => {
    if (p.ready && !canClip && topic === "clip") store.setState({ topic: "findings" });
  }, [p.ready, canClip, topic, store]);

  // Spec §4 "Tool keys": if the panel is open it switches to the armed tool's topic.
  useEffect(() => {
    const t = TOPIC_OF_TOOL[p.active];
    if (t !== "nav") store.getState().revealTopicFor(t);
  }, [p.active, store]);

  const tools = (id: CloudTopicId): TopicTool[] =>
    toolsOf(id).map((e) => ({
      id: e.id,
      icon: e.icon,
      label: e.label,
      shortcut: e.shortcut,
      active: p.active === e.id,
      disabledReason: p.isAvailable(e.id)
        ? null
        : "This view cannot " + (e.id === "clip" ? "clip" : "do this"),
      onClick: () => p.arm(e.id),
    }));

  const nav = toolsOf("nav").map((e) => (
    <ToolButton
      key={e.id}
      icon={e.icon}
      label={e.label}
      shortcut={e.shortcut}
      active={p.active === e.id}
      disabled={!p.isAvailable(e.id)}
      onClick={() => p.arm(e.id)}
    />
  ));

  const { findings, measure } = p.features;
  const { detail, shows } = useLatestDetail(findings, measure);
  const all: RailTopic[] = [
    {
      id: "layers",
      label: "Layers",
      icon: "layers",
      group: "shared",
      body: <TopicPanel title="Layers">{p.layersBody}</TopicPanel>,
    },
    {
      id: "findings",
      label: "Findings",
      icon: "findings",
      group: "shared",
      body: (
        <TopicPanel
          title="Findings"
          count={findings?.count ?? null}
          tools={tools("findings")}
          menu={
            findings?.menu?.length ? (
              <MenuButton label="Findings actions" iconOnly size="sm" items={[...findings.menu]} />
            ) : undefined
          }
        >
          <InspectorShowsContext.Provider value={shows}>{findings?.list}</InspectorShowsContext.Provider>
        </TopicPanel>
      ),
    },
    {
      id: "measure",
      label: "Measure",
      icon: "measure",
      group: "shared",
      body: (
        <TopicPanel title="Measure" count={measure?.count ?? null} tools={tools("measure")}>
          {measure?.list}
        </TopicPanel>
      ),
    },
    {
      id: "clip",
      label: "Clip",
      icon: "clip-box",
      group: "workspace",
      body: (
        <TopicPanel title="Clip" tools={tools("clip")}>
          {p.clipBody}
        </TopicPanel>
      ),
    },
    {
      id: "photos",
      label: "Photos",
      icon: "camera",
      group: "workspace",
      body: (
        <TopicPanel title="Photos" tools={tools("photos")}>
          {p.photosBody}
        </TopicPanel>
      ),
    },
  ];
  const topics = canClip ? all : all.filter((t) => t.id !== "clip");
  return { store, topics, nav, detail };
}

type Selection = string | null;
const keyOf = (t: TopicContent | null): Selection => (t?.detail ? (t.selectionKey ?? "selected") : null);

/**
 * Ruling R10: the inspector shows the most recently selected item, a finding or a measurement,
 * whatever the rail shows; when that one is deselected, the other (if any) shows.
 */
function useLatestDetail(
  findings: TopicContent | null,
  measure: TopicContent | null,
): { detail: ReactNode | null; shows: InspectorShows } {
  const f = keyOf(findings);
  const m = keyOf(measure);
  // Derived from the previous render's selections (React's "adjust state on a prop change").
  const [seen, setSeen] = useState<{ f: Selection; m: Selection; last: "findings" | "measure" }>(() => ({
    f,
    m,
    last: f === null && m !== null ? "measure" : "findings",
  }));
  let last = seen.last;
  if (seen.f !== f || seen.m !== m) {
    if (m !== null && m !== seen.m) last = "measure";
    if (f !== null && f !== seen.f) last = "findings";
    setSeen({ f, m, last });
  }
  const fd = findings?.detail ?? null;
  const md = measure?.detail ?? null;
  const shows: InspectorShows =
    last === "measure" ? (md ? "measure" : fd ? "findings" : null) : fd ? "findings" : md ? "measure" : null;
  return { detail: shows === "measure" ? md : shows === "findings" ? fd : null, shows };
}
