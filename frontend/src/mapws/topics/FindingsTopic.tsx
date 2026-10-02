import { useMemo } from "react";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { TopicList, TopicPanel, severityOf, useSeverityScale } from "@/ui";
import { FindingsRowExtra } from "../findings/FindingsRowExtra";
import { useMapFindingsStore } from "../findings/store";
import { findingFilters } from "../findings/tooltip";
import { zoneFilters } from "../zones/categories";
import { ZonesRowExtra } from "../zones/ZonesRowExtra";
import { useZonesStore } from "../zones/store";
import { findingCoords, findingItems, zoneItems } from "./listItems";
import { useTopicTools } from "./TopicTools";
import type { MapTopicProps } from "./types";
import { useTopicSelection } from "./useTopicSelection";
import { useRowStyle, useTopicVisibility } from "./useTopicRows";

/** Spec §3.1 Findings: point, polygon and zone tools; status, severity, category; findings and zones. */
export function FindingsTopic({ rows, projectId, context }: MapTopicProps) {
  const vis = useTopicVisibility(rows, "findings");
  const tools = useTopicTools("findings", context, vis.show);
  const f = useRowStyle(rows, "findings");
  const z = useRowStyle(rows, "zones");
  const byId = useMapFindingsStore((s) => s.byId);
  const zones = useZonesStore((s) => s.items);
  const { all } = useProjectTypes(projectId);
  const scale = useSeverityScale();
  const items = useMemo(() => {
    const name = (id: string) => all.find((t) => t.id === id)?.name;
    const pins = Object.values(byId);
    const swatch = new Map(pins.map((p) => [`finding:${p.id}`, severityOf(scale, p.severity)?.colour]));
    const { categories } = zoneFilters(z.style);
    return [
      ...findingItems(pins, findingFilters(f.style), name).map((i) => ({ ...i, swatch: swatch.get(i.id) })),
      ...zoneItems(zones.filter((a) => categories.includes(a.category))),
    ];
  }, [byId, zones, f.style, z.style, all, scale]);
  const { selectedId, onSelect } = useTopicSelection((id) => {
    if (id.startsWith("finding:")) {
      const pin = byId[id.slice("finding:".length)];
      return pin ? findingCoords(pin) : undefined;
    }
    return zones.find((a) => `zone:${a.id}` === id)?.polygon_site ?? undefined;
  });
  return (
    <TopicPanel
      title="Findings"
      count={items.length}
      visible={vis}
      tools={tools}
      filters={
        <div className="flex flex-col gap-3">
          {f.row && <FindingsRowExtra row={f.row} style={f.style} setStyle={f.setStyle} />}
          {z.row && <ZonesRowExtra row={z.row} style={z.style} setStyle={z.setStyle} />}
        </div>
      }
    >
      <TopicList
        label="Findings and zones"
        items={items}
        selectedId={selectedId}
        onSelect={onSelect}
        empty={<p className="px-1 text-sm text-muted">No findings in view. Press M and click the map.</p>}
      />
    </TopicPanel>
  );
}
