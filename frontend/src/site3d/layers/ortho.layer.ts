import type { SceneOrtho } from "@/api/siteScene";
import { TileDrapeLayer, extent } from "./tileDrape";

/** The site ortho at the datum (scene y = 0): ruling R9. */
export const ORTHO_Y = 0;

export function createOrthoLayer(
  o: SceneOrtho,
  url: (rel: string) => string,
  onGone?: () => void,
): TileDrapeLayer {
  return new TileDrapeLayer(
    {
      id: `ortho:${o.id}`,
      label: o.name,
      template: url(o.tile_url_template),
      bounds: extent(o.bounds_site),
      minZ: o.min_z,
      maxZ: o.max_z,
      sceneY: ORTHO_Y,
      renderOrderBase: 0,
      opacity: 1,
    },
    onGone,
  );
}
