import { GlassPanel, Icon } from "@/ui";
import { useTools, useWorkspace } from "../context";
import { inspectorRegistry } from "../inspect/inspectorRegistry";
import { useRegistry } from "../registry";
import { toolRegistry } from "../tools/toolStore";

/** The hint pill (spec §5 Tool hint): the active tool's icon, name and instruction; it flashes on change. */
export function ToolHint() {
  const tools = useRegistry(toolRegistry);
  const inspectors = useRegistry(inspectorRegistry);
  const active = useTools((s) => s.active);
  const selection = useWorkspace((s) => s.selection);
  const tool = tools.find((t) => t.id === active);
  const selectionHint = selection ? inspectors.find((k) => k.id === selection.kind)?.hint?.(selection) : null;
  if (!tool) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[70px] z-10 flex justify-center">
      <GlassPanel
        key={selectionHint ? "review" : tool.id}
        variant="float"
        role="status"
        data-testid="tool-hint"
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted animate-reveal reduce-motion:animate-none"
      >
        <Icon name={tool.icon} size={14} className="text-accent-ink" />
        {selectionHint ? (
          <span>{selectionHint}</span>
        ) : (
          <span>
            <b className="font-medium text-ink">{tool.label}</b>
            {tool.hint && ` · ${tool.hint}`}
          </span>
        )}
      </GlassPanel>
    </div>
  );
}
