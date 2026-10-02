import { ALIGN_TOOL_ID, AlignOverlay } from "../drawings/AlignOverlay";
import type { MapTool } from "./toolStore";

/** W5's tool plugin: Align drawing (K), spec §5.1 and §8.3. */
const alignDrawing: MapTool = {
  id: ALIGN_TOOL_ID,
  topic: "drawings",
  order: 20,
  icon: "align",
  label: "Align drawing",
  action: "align-drawing",
  hint: "Click a point on the drawing, then the same point on the map · Enter saves · Esc cancels a pending click · Backspace removes the last pair",
  draw: { shape: "point" },
  // Ruling R11: Align is armed from the Drawings tool row or the drawing inspector, on a selected
  // drawing; the drawing row's menu has no Align. PF2: the row's contract `status`.
  disabledReason: ({ selection, layers }) => {
    if (selection?.kind !== "drawing") return "Choose a drawing first";
    const row = layers.find((l) => l.kind === "drawing" && l.id === selection.id);
    if (row?.status === "importing") return "The drawing is still importing";
    return row?.status === "failed" ? "The drawing failed to import" : null;
  },
  Overlay: AlignOverlay,
};

export default alignDrawing;
