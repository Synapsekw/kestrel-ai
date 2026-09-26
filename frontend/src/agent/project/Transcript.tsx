import type { AgentItem, AgentTurn } from "@contract/client";
import { ApprovalCard } from "./ApprovalCard";
import { ToolRow } from "./ToolRow";

/** User bubbles, assistant text and one row per tool call, oldest first. */
export function Transcript({
  items,
  turn,
  awaiting,
  deciding,
  onDecide,
}: {
  items: AgentItem[];
  /** The newest turn: a succeeded turn whose last answer is empty still says it finished. */
  turn: AgentTurn | null;
  /** The turn waits on an approval; the card shows under the tool call that asked. */
  awaiting: boolean;
  deciding: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const finishedId =
    turn?.state === "succeeded"
      ? items.filter((i) => i.kind === "assistant" && i.turn_id === turn.id).at(-1)?.id
      : undefined;
  return (
    <div role="log" aria-label="Agent conversation" aria-live="polite" className="flex flex-col gap-3">
      {items.map((item) => {
        if (item.kind === "user") {
          return (
            <div key={item.id} className="rounded-md bg-surface-2 px-3 py-2">
              <p className="mb-1 text-xs font-medium text-muted">You</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.text}</p>
            </div>
          );
        }
        if (item.kind === "assistant") {
          const text = item.text.trim() ? item.text : item.id === finishedId ? "Finished." : "";
          if (!text) return null;
          return (
            <div key={item.id} className="py-1">
              <p className="mb-1 text-xs font-medium text-muted">Project agent</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
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
