import { useAddData, type AddDataTile } from "@/app/addDataStore";
import type { IconName } from "@/ui";

export interface AddDataTileInfo {
  tile: AddDataTile | "drawing";
  title: string;
  hint: string;
  icon: IconName;
  /** Present when the tile cannot be used yet. */
  disabledReason?: string;
}

/** F §6.4's five tiles, in the order the dialog shows them. */
export const ADD_DATA_TILES: AddDataTileInfo[] = [
  { tile: "photos", title: "Photos", hint: "A folder of drone photos (JPEG)", icon: "images" },
  { tile: "orthomosaic", title: "Orthomosaic", hint: "A GeoTIFF map", icon: "map" },
  {
    tile: "elevation",
    title: "Elevation",
    hint: "A design surface, or a DSM built from a cloud",
    icon: "elevation",
  },
  { tile: "point_cloud", title: "Point cloud", hint: "LAS or LAZ", icon: "cloud" },
  {
    tile: "drawing",
    title: "Drawing",
    hint: "DXF, LandXML, or a PDF/PNG plan",
    icon: "drawing",
    disabledReason: "Arrives with the Maps workspace",
  },
];

/** The tooltip on an Add data button while the shell is still loading the project (SH's gate wording). */
export const ADD_DATA_LOADING = "Project is still loading";

/** True once the shell has loaded `projectId` (the host published it), so Add data imports into it. */
export function useAddDataReady(projectId: string | null | undefined): boolean {
  return useAddData((s) => !!projectId && s.projectId === projectId);
}

/**
 * The one way in for S1's empty states; the project is the shell's loaded one. A no-op while no
 * project is loaded, so a click is never swallowed by a host that cannot render yet.
 */
export function openAddData(tile?: AddDataTile): void {
  const state = useAddData.getState();
  if (!state.projectId) return;
  state.show(tile ?? null);
}
