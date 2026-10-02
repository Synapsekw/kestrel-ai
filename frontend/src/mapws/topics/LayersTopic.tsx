import { MenuButton, TopicPanel } from "@/ui";
import { LayerGroups } from "../chrome/LayerGroups";
import { useLayerAddItems } from "../chrome/layerAddItems";
import type { MapTopicProps } from "./types";

const GROUPS = ["base", "elevation"] as const;

/** Spec §3.1 Layers: base maps and elevation rows, one "+" import menu (no drawings: they have a topic). */
export function LayersTopic({ rows, notInCompare, projectId }: MapTopicProps) {
  const add = useLayerAddItems(projectId);
  const count = rows.filter((r) => (r.group === "base" || r.group === "elevation") && !r.unavailable).length;
  return (
    <TopicPanel
      title="Layers"
      count={count}
      menu={<MenuButton iconOnly icon="plus" size="sm" variant="ghost" label="Add a layer" items={add} />}
    >
      <LayerGroups groups={GROUPS} rows={rows} notInCompare={notInCompare} />
    </TopicPanel>
  );
}
