import type { TopicTool } from "@/ui";
import { useTools } from "../context";
import { useRegistry } from "../registry";
import { shortcutFor, toolRegistry, toolsOfTopic, type ToolContext } from "../tools/toolStore";
import type { MapTopicId } from "./topicIds";

/** One topic's map tools as the panel's tool row; `beforeActivate` runs before a tool starts. */
export function useTopicTools(
  topic: MapTopicId,
  context: ToolContext,
  beforeActivate?: () => void,
): TopicTool[] {
  const tools = useRegistry(toolRegistry);
  const active = useTools((s) => s.active);
  const activate = useTools((s) => s.activate);
  return toolsOfTopic(tools, topic).map((t) => ({
    id: t.id,
    icon: t.icon,
    label: t.label,
    shortcut: shortcutFor(t.action),
    active: active === t.id,
    disabledReason: t.disabledReason?.(context) ?? null,
    onClick: () => {
      beforeActivate?.();
      activate(t.id);
    },
  }));
}
