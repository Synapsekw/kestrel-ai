import type { ComponentType } from "react";
import "@/mapws/plugins";
import type { MapFindingPin } from "@/api/mapFindings";
import { useWorkspace } from "../context";
import { useMapFindingsStore } from "../findings/store";
import { layerRegistry, type LayerRowsContext } from "../layers/layerRegistry";
import { makeStores, renderInWorkspace } from "../test/harness";
import { UTM33, layer } from "../test/fixtures";
import type { ToolContext } from "../tools/toolStore";
import type { MapTopicProps } from "./types";

export interface TopicOpts {
  findings?: { id: string; number: number; severity?: number | null }[];
  drawing?: boolean;
}

const pin = (f: { id: string; number: number; severity?: number | null }): MapFindingPin => ({
  id: f.id,
  number: f.number,
  type_id: "t",
  severity: f.severity ?? null,
  status: "open",
  created_by: "human",
  map_id: "m1",
  geometry_site: { type: "Point", coordinates: [10, 20] },
});

/** Renders one map topic over every registered layer kind's rows, with a reactive tool context. */
export function renderTopic(Topic: ComponentType<MapTopicProps>, opts: TopicOpts = {}) {
  useMapFindingsStore.getState().setSide("single", (opts.findings ?? []).map(pin), false);
  const stores = makeStores();
  const layers = [
    layer("map", "m1", { date: "2026-09-14" }),
    ...(opts.drawing ? [layer("drawing", "d1", { name: "Site plan" })] : []),
  ];
  const ctx: LayerRowsContext = {
    projectId: "p",
    frame: UTM33,
    layers,
    surveys: stores.workspace.getState().surveys,
  };
  const rows = layerRegistry.all().flatMap((k) => k.rows(ctx));
  function Host() {
    const selection = useWorkspace((s) => s.selection);
    const surveys = useWorkspace((s) => s.surveys);
    const r = useWorkspace((s) => s.r);
    const context: ToolContext = { frame: UTM33, selection, surveys, layers, r };
    return <Topic rows={rows} notInCompare={new Set()} projectId="p" context={context} />;
  }
  renderInWorkspace(<Host />, { stores });
  return { workspace: stores.workspace, tools: stores.tools, rows };
}
