import { useMemo } from "react";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { Button, TopicList, TopicPanel } from "@/ui";
import { DetectionFilters } from "../detect/DetectionFilters";
import { parseDetectionId } from "../detect/detectModel";
import { useDetectStore } from "../detect/detectStore";
import { useRasterActions } from "../layers/rasterMenu";
import { detectionItems } from "./listItems";
import { useTopicTools } from "./TopicTools";
import type { MapTopicProps } from "./types";
import { useTopicSelection } from "./useTopicSelection";
import { useTopicVisibility } from "./useTopicRows";

/** Spec §3.1 AI: detect region, Run on the whole map, the review filters, the review queue. */
export function AiTopic({ rows, projectId, context }: MapTopicProps) {
  const vis = useTopicVisibility(rows, "ai");
  const tools = useTopicTools("ai", context, vis.show);
  const filters = useDetectStore((s) => s.filters);
  const inView = useDetectStore((s) => s.inView);
  const byId = useDetectStore((s) => s.byId);
  const { types } = useProjectTypes(projectId);
  const items = useMemo(
    () => detectionItems(inView, byId, filters, (id) => types.get(id)),
    [inView, byId, filters, types],
  );
  const mapRow = rows.find((r) => r.kind === "map" && r.date === context.r && !r.unavailable);
  const { selectedId, onSelect } = useTopicSelection((itemId) => {
    const parsed = parseDetectionId(itemId.slice("detection:".length));
    return parsed ? (byId.get(parsed.detectionId)?.d.corners_site ?? undefined) : undefined;
  });
  return (
    <TopicPanel
      title="AI"
      count={items.length}
      visible={vis}
      tools={tools}
      filters={
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            icon="detect"
            disabled={!mapRow}
            title={mapRow ? undefined : "This survey has no map to run on"}
            onClick={() => mapRow && useRasterActions.getState().request({ type: "run", row: mapRow })}
          >
            Run on the whole map
          </Button>
          <DetectionFilters />
        </div>
      }
    >
      <TopicList
        label="Review queue"
        items={items}
        selectedId={selectedId}
        onSelect={onSelect}
        empty={<p className="px-1 text-sm text-muted">No detections in view.</p>}
      />
    </TopicPanel>
  );
}
