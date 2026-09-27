import { Fragment } from "react";
import { FloatingToolbar, ToolButton, ToolSeparator, useToolShortcuts } from "@/ui";
import { useRegistry } from "../registry";
import { useTools } from "../context";
import { groupTools, shortcutFor, toolRegistry, type ToolContext } from "../tools/toolStore";

/** The tool palette (spec §5, R-W1-10): four groups separated by rules; keys from ui/keymap.ts. */
export function ToolPalette({ context }: { context: ToolContext }) {
  const tools = useRegistry(toolRegistry);
  const active = useTools((s) => s.active);
  const activate = useTools((s) => s.activate);
  const groups = groupTools(tools);
  const defs = groups.flat().map((tool) => ({
    tool,
    shortcut: shortcutFor(tool.action),
    reason: tool.disabledReason?.(context) ?? null,
  }));
  useToolShortcuts(
    defs.map((d) => ({
      shortcut: d.shortcut,
      action: d.tool.action,
      disabled: d.reason !== null,
      onTrigger: () => activate(d.tool.id),
    })),
  );
  const byId = new Map(defs.map((d) => [d.tool.id, d]));
  return (
    // FloatingToolbar's own animate-reveal is the palette's entrance (it takes no style prop).
    <FloatingToolbar label="Map tools" shortcuts={false} className="absolute left-4 top-4 z-10">
      {groups.map((group, gi) => (
        <Fragment key={group[0].group}>
          {gi > 0 && <ToolSeparator />}
          {group.map((tool) => {
            const d = byId.get(tool.id)!;
            return (
              <ToolButton
                key={tool.id}
                icon={tool.icon}
                label={d.reason ? `${tool.label} — ${d.reason}` : tool.label}
                shortcut={d.shortcut}
                active={active === tool.id}
                disabled={d.reason !== null}
                onClick={() => activate(tool.id)}
              />
            );
          })}
        </Fragment>
      ))}
    </FloatingToolbar>
  );
}
