import type { LayerKind } from "@/mapws/annotations/bindings";
import { zonesRows } from "@/mapws/zones/categories";
import { ZonesLayer } from "@/mapws/zones/ZonesLayer";
import { ZonesRowExtra } from "@/mapws/zones/ZonesRowExtra";

/** Spec §5.2 Annotations › Site areas & zones (W3-1, §9.4). */
const zones: LayerKind = {
  id: "zones",
  group: "annotations",
  icon: "zone",
  rows: zonesRows,
  Mount: ZonesLayer,
  RowExtra: ZonesRowExtra,
};

export default zones;
