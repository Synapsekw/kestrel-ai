import type { MapTool } from "@/mapws/annotations/bindings";
import { zoneToolUnavailable } from "@/mapws/zones/actions";
import { ZoneOverlay } from "@/mapws/zones/ZoneOverlay";

/** Spec §5.1 `Z`: a polygon → name and category → a site area (M15). */
const zone: MapTool = {
  id: "zone",
  topic: "findings",
  order: 30,
  icon: "zone",
  label: "Zone",
  action: "zone",
  hint: "Click the corners · double-click to close · then name it",
  draw: { shape: "polygon", min: 3 },
  disabledReason: zoneToolUnavailable,
  Overlay: ZoneOverlay,
};

export default zone;
