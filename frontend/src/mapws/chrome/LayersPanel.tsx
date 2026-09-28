import { useMemo } from "react";
import { GlassPanel, Icon, IconButton, MenuButton, cx, focusRing, stagger, type MenuItem } from "@/ui";
import { ADD_DATA_LOADING, openAddData, useAddDataReady } from "@/data/addDataTiles";
import { useShallow } from "zustand/react/shallow";
import { useWorkspace } from "../context";
import {
  GROUP_LABEL,
  GROUP_ORDER,
  layerRegistry,
  type LayerGroup,
  type LayerRow,
} from "../layers/layerRegistry";
import { effectiveState, orderRows } from "../layers/placement";
import { useRegistry } from "../registry";
import { LayerRowView } from "./LayerRowView";

export interface LayersPanelProps {
  rows: readonly LayerRow[];
  notInCompare: ReadonlySet<string>;
  projectId: string;
}

/** The layers panel (spec §5 Layers, §5.2): groups top to bottom Base maps → Annotations. */
export function LayersPanel({ rows, notInCompare, projectId }: LayersPanelProps) {
  const kinds = useRegistry(layerRegistry);
  const kindById = useMemo(() => new Map(kinds.map((k) => [k.id, k])), [kinds]);
  const { layerState, order, collapsed } = useWorkspace(
    useShallow((s) => ({
      layerState: s.layerState,
      order: s.order,
      collapsed: s.layersCollapsed,
    })),
  );
  const setLayerState = useWorkspace((s) => s.setLayerState);
  const setOrder = useWorkspace((s) => s.setOrder);
  const toggle = useWorkspace((s) => s.toggleLayersCollapsed);
  const ready = useAddDataReady(projectId);

  // F3: `satisfies MenuItem[]` keeps each `icon` a literal IconName instead of widening to `string`.
  const add = (
    [
      {
        id: "ortho",
        label: "Import orthomosaic",
        icon: "map",
        onSelect: () => openAddData("orthomosaic"),
      },
      {
        id: "elevation",
        label: "Import elevation",
        icon: "elevation",
        onSelect: () => openAddData("elevation"),
      },
      {
        id: "dsm",
        label: "Build DSM from cloud",
        icon: "cloud",
        onSelect: () => openAddData("elevation"),
      },
      {
        id: "drawing",
        label: "Import drawing",
        icon: "drawing",
        onSelect: () => openAddData("drawing"),
      },
    ] satisfies MenuItem[]
  ).map((item) => ({
    ...item,
    disabled: !ready,
    hint: ready ? undefined : ADD_DATA_LOADING,
  }));

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    rows: orderRows(
      rows.filter((r) => r.group === group),
      order[group],
    ),
  })).filter((g) => g.rows.length > 0 || g.group === "drawings");
  const count = rows.filter((r) => !r.unavailable).length;

  const move = (group: LayerGroup, keys: string[], from: number, to: number) => {
    if (to < 0 || to >= keys.length) return;
    const next = [...keys];
    const [k] = next.splice(from, 1);
    next.splice(to, 0, k);
    setOrder(group, next);
  };

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
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {grouped.map(({ group, rows: groupRows }) => {
            const keys = groupRows.map((r) => r.key);
            return (
              <section key={group} aria-label={GROUP_LABEL[group]} className="mt-2 first:mt-0">
                <div className="flex items-center justify-between px-1.5 py-1">
                  <h3 className="text-2xs font-medium text-muted">{GROUP_LABEL[group]}</h3>
                  {group === "drawings" && (
                    <button
                      type="button"
                      disabled={!ready}
                      onClick={() => openAddData()}
                      className={cx(
                        "rounded-chip text-2xs text-accent-ink hover:underline disabled:opacity-45",
                        focusRing,
                      )}
                    >
                      + Import
                    </button>
                  )}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {groupRows.map((row, i) => (
                    <LayerRowView
                      key={row.key}
                      row={row}
                      kind={kindById.get(row.kind)}
                      state={effectiveState(row, kindById.get(row.kind), layerState)}
                      notInCompare={notInCompare.has(row.key)}
                      onState={(patch) => setLayerState(row.key, patch)}
                      onMove={(delta) => move(group, keys, i, i + delta)}
                      onDropOn={(dragged) => {
                        const from = keys.indexOf(dragged);
                        if (from >= 0) move(group, keys, from, i);
                      }}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}
