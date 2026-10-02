import { useMemo } from "react";
import { useToolShortcuts } from "@/ui";
import { useTools } from "../context";
import { useRegistry } from "../registry";
import { shortcutFor, toolRegistry, type ToolContext } from "./toolStore";

/** Every tool's key, whatever topic is open (spec §4 "Tool keys"). */
export function useMapToolKeys(context: ToolContext): void {
  const tools = useRegistry(toolRegistry);
  const activate = useTools((s) => s.activate);
  const keys = useMemo(
    () =>
      tools.map((t) => ({
        shortcut: shortcutFor(t.action),
        action: t.action,
        disabled: (t.disabledReason?.(context) ?? null) !== null,
        onTrigger: () => activate(t.id),
      })),
    [tools, context, activate],
  );
  useToolShortcuts(keys);
}
