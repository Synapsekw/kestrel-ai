import { VolumeDrawOverlay } from "../volume/VolumeDrawOverlay";
import { volumeToolDisabled } from "../volume/volumeModel";
import type { MapTool } from "../w4host";

/** U: draw a stockpile's polygon on the r date's DSM (spec §10); also the inspector's mask pen (T8-2). */
const volumeTool: MapTool = {
  id: "volume",
  topic: "measure",
  order: 40,
  icon: "volume",
  label: "Volume",
  action: "volume",
  hint: "Click to add vertices · double-click to close · Esc cancels",
  draw: { shape: "polygon", min: 3 },
  // The same topLayerFor as the completion (R-W4-14).
  disabledReason: (ctx) => volumeToolDisabled(ctx.layers, ctx.r),
  Overlay: VolumeDrawOverlay,
};

export default volumeTool;
