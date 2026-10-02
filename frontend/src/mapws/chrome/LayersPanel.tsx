import { GlassPanel, Icon, IconButton, MenuButton, cx, stagger } from "@/ui";
import { useWorkspace } from "../context";
import { GROUP_ORDER, type LayerRow } from "../layers/layerRegistry";
import { LayerGroups } from "./LayerGroups";
import { useLayerAddItems } from "./layerAddItems";

export interface LayersPanelProps {
  rows: readonly LayerRow[];
  notInCompare: ReadonlySet<string>;
  projectId: string;
}

/** The layers panel (spec §5 Layers, §5.2): groups top to bottom Base maps → Annotations. */
export function LayersPanel({ rows, notInCompare, projectId }: LayersPanelProps) {
  const collapsed = useWorkspace((s) => s.layersCollapsed);
  const toggle = useWorkspace((s) => s.toggleLayersCollapsed);
  const add = useLayerAddItems(projectId, { drawing: true });
  const count = rows.filter((r) => !r.unavailable).length;

  return (
    <GlassPanel
      as="section"
      variant="float"
      radius="panel"
      aria-label="Layers"
      style={stagger(1)}
      className="stagger absolute left-[72px] top-4 z-10 flex max-h-[calc(100%-140px)] w-[290px] flex-col animate-rise reduce-motion:animate-none"
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <IconButton
          size="sm"
          icon="chevron-down"
          label={collapsed ? "Expand layers" : "Collapse layers"}
          aria-expanded={!collapsed}
          onClick={toggle}
          className={cx(
            "transition-transform duration-emphasis ease-out reduce-motion:transition-none",
            collapsed && "-rotate-90",
          )}
        />
        <Icon name="layers" size={16} className="text-muted" />
        <h2 className="text-sm font-medium text-ink">Layers</h2>
        <span className="font-mono text-2xs text-muted tabular-nums">{count}</span>
        <span className="flex-1" />
        <MenuButton iconOnly icon="plus" size="sm" variant="ghost" label="Add a layer" items={add} />
      </header>
      {!collapsed && <LayerGroups groups={GROUP_ORDER} rows={rows} notInCompare={notInCompare} />}
    </GlassPanel>
  );
}
