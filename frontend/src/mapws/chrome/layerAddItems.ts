import { ADD_DATA_LOADING, openAddData, useAddDataReady } from "@/data/addDataTiles";
import type { MenuItem } from "@/ui";

/**
 * The Layers "+" menu (spec §3.1): orthomosaic, elevation, DSM from cloud, and — while the old
 * LayersPanel is still mounted — Import drawing. Disabled until Add data is ready.
 */
export function useLayerAddItems(projectId: string, opts: { drawing: boolean }): MenuItem[] {
  const ready = useAddDataReady(projectId);
  // F3: `satisfies MenuItem[]` keeps each `icon` a literal IconName instead of widening to `string`.
  const items = [
    { id: "ortho", label: "Import orthomosaic", icon: "map", onSelect: () => openAddData("orthomosaic") },
    {
      id: "elevation",
      label: "Import elevation",
      icon: "elevation",
      onSelect: () => openAddData("elevation"),
    },
    { id: "dsm", label: "Build DSM from cloud", icon: "cloud", onSelect: () => openAddData("elevation") },
    { id: "drawing", label: "Import drawing", icon: "drawing", onSelect: () => openAddData("drawing") },
  ] satisfies MenuItem[];
  return items
    .filter((i) => opts.drawing || i.id !== "drawing")
    .map((item) => ({ ...item, disabled: !ready, hint: ready ? undefined : ADD_DATA_LOADING }));
}
