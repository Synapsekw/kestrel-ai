import { evaluateHref } from "../links";
import type { LayerKind } from "./layerRegistry";

/**
 * Spec §14: a map with no CRS (M-C0's `in_frame: false` map row) is not in the site frame; it is listed
 * greyed and opens in the evaluation view. W2's base-map kind lists only `in_frame` maps.
 */
const noCoordinates: LayerKind = {
  id: "map_nocrs",
  group: "base",
  icon: "map",
  opacity: false,
  rows: (ctx) =>
    ctx.layers
      .filter((l) => l.kind === "map" && !l.in_frame)
      .map((m) => ({
        key: `map_nocrs:${m.id}`,
        kind: "map_nocrs",
        group: "base",
        id: m.id,
        name: m.name,
        meta: "",
        date: null,
        unavailable: {
          reason: "No coordinates",
          href: evaluateHref(ctx.projectId, m.id),
          linkLabel: "Open in evaluation view",
        },
      })),
};

export default noCoordinates;
