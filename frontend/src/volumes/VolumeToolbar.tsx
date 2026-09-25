import { useEffect } from "react";
import { isTypingTarget } from "@/editor/hotkeys";
import { Button, Kbd } from "@/ui";
import type { VolumeTool } from "./volumeLayers";

const TOOLS: { tool: VolumeTool; label: string; key: string; needsMeasurement: boolean }[] = [
  { tool: "pan", label: "Pan", key: "V", needsMeasurement: false },
  { tool: "measure", label: "Draw measurement", key: "P", needsMeasurement: false },
  { tool: "stable", label: "Stable area", key: "S", needsMeasurement: true },
  { tool: "exclusion", label: "Exclusion", key: "X", needsMeasurement: true },
  { tool: "edit", label: "Edit vertices", key: "E", needsMeasurement: true },
];

/**
 * The drawing tools (spec section 9): Pan V, Draw measurement P, Stable area S, Exclusion X, Edit
 * vertices E; Esc cancels a drawing (back to Pan) and Del deletes the selected exclusion.
 */
export function VolumeToolbar({
  tool,
  onTool,
  hasMeasurement,
  onDeleteSelected,
}: {
  tool: VolumeTool;
  onTool: (t: VolumeTool) => void;
  hasMeasurement: boolean;
  onDeleteSelected: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") return onTool("pan");
      if (e.key === "Delete") return onDeleteSelected();
      const hit = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (hit && (!hit.needsMeasurement || hasMeasurement)) onTool(hit.tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTool, onDeleteSelected, hasMeasurement]);

  return (
    <div
      role="toolbar"
      aria-label="Drawing tools"
      className="absolute left-3 top-3 flex gap-1 rounded-md border border-line bg-panel p-1 shadow-float"
    >
      {TOOLS.map((t) => (
        <Button
          key={t.tool}
          size="sm"
          variant={tool === t.tool ? "primary" : "ghost"}
          aria-pressed={tool === t.tool}
          disabled={t.needsMeasurement && !hasMeasurement}
          onClick={() => onTool(t.tool)}
        >
          {t.label} <Kbd>{t.key}</Kbd>
        </Button>
      ))}
    </div>
  );
}
