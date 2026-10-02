import { ADD_DATA_LOADING, openAddData, useAddDataReady } from "@/data/addDataTiles";
import { Button, TopicPanel } from "@/ui";
import { LayerGroups } from "../chrome/LayerGroups";
import { useTopicTools } from "./TopicTools";
import type { MapTopicProps } from "./types";

const GROUPS = ["drawings"] as const;

/** Spec §3.1 Drawings: one "Import drawing" action, Align (K) on the selected drawing, the drawing rows. */
export function DrawingsTopic({ rows, notInCompare, projectId, context }: MapTopicProps) {
  const ready = useAddDataReady(projectId);
  const tools = useTopicTools("drawings", context);
  const count = rows.filter((r) => r.group === "drawings").length;
  return (
    <TopicPanel
      title="Drawings"
      count={count}
      tools={tools}
      menu={
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          disabled={!ready}
          title={ready ? undefined : ADD_DATA_LOADING}
          onClick={() => openAddData("drawing")}
        >
          Import drawing
        </Button>
      }
    >
      <LayerGroups groups={GROUPS} rows={rows} notInCompare={notInCompare} />
    </TopicPanel>
  );
}
