import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspace } from "../context";
import { GROUP_LABEL, layerRegistry, type LayerGroup, type LayerRow } from "../layers/layerRegistry";
import { effectiveState, orderRows } from "../layers/placement";
import { useRegistry } from "../registry";
import { LayerRowView } from "./LayerRowView";

export interface LayerGroupsProps {
  rows: readonly LayerRow[];
  notInCompare: ReadonlySet<string>;
  groups: readonly LayerGroup[];
}

/** The layer rows of `groups`, top to bottom, with eye, opacity, reorder and the row menu. */
export function LayerGroups({ rows, notInCompare, groups }: LayerGroupsProps) {
  const kinds = useRegistry(layerRegistry);
  const kindById = useMemo(() => new Map(kinds.map((k) => [k.id, k])), [kinds]);
  const { layerState, order } = useWorkspace(
    useShallow((s) => ({ layerState: s.layerState, order: s.order })),
  );
  const setLayerState = useWorkspace((s) => s.setLayerState);
  const setOrder = useWorkspace((s) => s.setOrder);

  const grouped = groups
    .map((group) => ({
      group,
      rows: orderRows(
        rows.filter((r) => r.group === group),
        order[group],
      ),
    }))
    .filter((g) => g.rows.length > 0 || g.group === "drawings");

  const move = (group: LayerGroup, keys: string[], from: number, to: number) => {
    if (to < 0 || to >= keys.length) return;
    const next = [...keys];
    const [k] = next.splice(from, 1);
    next.splice(to, 0, k);
    setOrder(group, next);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {grouped.map(({ group, rows: groupRows }) => {
        const keys = groupRows.map((r) => r.key);
        return (
          <section key={group} aria-label={GROUP_LABEL[group]} className="mt-2 first:mt-0">
            <div className="flex items-center justify-between px-1.5 py-1">
              <h3 className="text-2xs font-medium text-muted">{GROUP_LABEL[group]}</h3>
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
  );
}
