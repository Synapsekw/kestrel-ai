import { useEffect } from "react";
import { isTypingTarget } from "@/ui/keymap";
import { Button, Kbd } from "@/ui";
import type { VolumeTool } from "./volumeLayers";

// `short` is what the bar shows (it has to fit a 1280 px window next to both side panels); `label`
// is the full name, used as the accessible name and the tooltip.
const TOOLS: { tool: VolumeTool; short: string; label: string; key: string; needsMeasurement: boolean }[] = [
  { tool: "pan", short: "Pan", label: "Pan", key: "V", needsMeasurement: false },
  { tool: "measure", short: "Measure", label: "Draw measurement", key: "P", needsMeasurement: false },
  { tool: "stable", short: "Stable", label: "Stable area", key: "S", needsMeasurement: true },
  { tool: "exclusion", short: "Exclude", label: "Exclusion", key: "X", needsMeasurement: true },
  { tool: "edit", short: "Edit", label: "Edit vertices", key: "E", needsMeasurement: true },
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
      className="flex flex-wrap gap-1 rounded-md border border-line bg-glass-solid p-1 shadow-float"
    >
      {TOOLS.map((t) => (
        <Button
          key={t.tool}
          size="sm"
          variant={tool === t.tool ? "primary" : "ghost"}
          aria-pressed={tool === t.tool}
          disabled={t.needsMeasurement && !hasMeasurement}
          onClick={() => onTool(t.tool)}
          aria-label={`${t.label} (${t.key})`}
          title={`${t.label} (${t.key})`}
        >
          {t.short} <Kbd>{t.key}</Kbd>
        </Button>
      ))}
    </div>
  );
}
