import { RegionDrawOverlay } from "../detect/RegionDrawOverlay";
import type { MapTool } from "../w4host";

/** D: drag a box over the orthomosaic; the region inspector runs AI detect inside it (spec §9.3). */
const aiRegionTool: MapTool = {
  id: "ai-region",
  group: "site",
  topic: "ai",
  order: 1,
  icon: "sparkle",
  label: "AI detect region",
  action: "ai-detect",
  hint: "Drag a box over the orthomosaic · Esc cancels",
  draw: { shape: "box" },
  disabledReason: (ctx) => (ctx.frame.kind === "local" ? "AI detect needs a site with coordinates" : null),
  Overlay: RegionDrawOverlay,
};

export default aiRegionTool;
