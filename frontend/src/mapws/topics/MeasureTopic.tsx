import { useMemo } from "react";
import { TopicList, TopicPanel } from "@/ui";
import { measureFilters } from "../measure/layerFeatures";
import { MeasurementRowExtra } from "../measure/MeasurementRowExtra";
import { useMeasurementsStore } from "../measure/store";
import { measurementItems } from "./listItems";
import { useTopicTools } from "./TopicTools";
import type { MapTopicProps } from "./types";
import { useTopicSelection } from "./useTopicSelection";
import { useRowStyle, useTopicVisibility } from "./useTopicRows";

/**
 * Spec §3.1 Measure: distance, area, profile and volume tools; the kind filter; the measurements.
 * Volumes have no bounded list store, so they are picked on the map; the header eye covers them.
 */
export function MeasureTopic({ rows, context }: MapTopicProps) {
  const vis = useTopicVisibility(rows, "measure");
  const tools = useTopicTools("measure", context, vis.show);
  const m = useRowStyle(rows, "measurements");
  const all = useMeasurementsStore((s) => s.items);
  const items = useMemo(() => measurementItems(all, measureFilters(m.style).kinds), [all, m.style]);
  const { selectedId, onSelect } = useTopicSelection(
    (id) => all.find((x) => `measurement:${x.id}` === id)?.vertices_site,
  );
  return (
    <TopicPanel
      title="Measure"
      count={items.length}
      visible={vis}
      tools={tools}
      filters={m.row && <MeasurementRowExtra row={m.row} style={m.style} setStyle={m.setStyle} />}
    >
      <TopicList
        label="Measurements"
        items={items}
        selectedId={selectedId}
        onSelect={onSelect}
        empty={<p className="px-1 text-sm text-muted">No measurements yet. Press L and click the map.</p>}
      />
    </TopicPanel>
  );
}
