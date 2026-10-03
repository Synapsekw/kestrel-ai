import { useMemo } from "react";
import { basemapTileUrl, type AssetModel } from "@contract/client";
import { useBackend } from "@/api/client";
import { groundTiles, type GroundTile } from "@/assetmodels/viewer/ground";

/** The streets basemap around the asset (spec §9 setGround); null when the frame has no origin. */
export function useGroundTiles(model: AssetModel): GroundTile[] | null {
  const { baseUrl, token } = useBackend();
  const frame = model.frame ?? null;
  return useMemo(() => {
    if (!frame?.origin) return null;
    const radius = Math.max(60, 3 * (frame.height_m ?? 20));
    return groundTiles(
      frame.origin,
      frame.north_offset_deg ?? 0,
      basemapTileUrl(baseUrl, token, "streets"),
      radius,
    );
  }, [frame, baseUrl, token]);
}
