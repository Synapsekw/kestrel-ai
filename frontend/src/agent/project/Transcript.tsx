import type { AgentItem } from "@contract/client";
import { ApprovalCard } from "./ApprovalCard";
import { ToolRow } from "./ToolRow";

/** User bubbles, assistant text and one row per tool call, oldest first. */
export function Transcript({
  items,
  awaiting,
  deciding,
  onDecide,
}: {
  items: AgentItem[];
  /** The turn waits on an approval; the card shows under the tool call that asked. */
  awaiting: boolean;
  deciding: boolean;
  onDecide: (approve: boolean) => void;
}) {
  return (
    <div role="log" aria-label="Agent conversation" aria-live="polite" className="flex flex-col gap-3">
      {items.map((item) => {
        if (item.kind === "user") {
          return (
            <div key={item.id} className="rounded-md bg-well px-3 py-2">
              <p className="mb-1 text-xs font-medium text-muted">You</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.text}</p>
            </div>
          );
        }
        if (item.kind === "assistant") {
          if (!item.text.trim()) return null;
          return (
            <div key={item.id} className="py-1">
              <p className="mb-1 text-xs font-medium text-muted">Project agent</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.text}</p>
            </div>
          );
        }
        return (
          <div key={item.id} className="flex flex-col gap-2">
            <ToolRow item={item} />
            {awaiting && item.tool_status === "awaiting_approval" && item.approval && (
              <ApprovalCard approval={item.approval} disabled={deciding} onDecide={onDecide} />
            )}
          </div>
        );
      })}
    </div>
  );
}
