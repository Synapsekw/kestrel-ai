import { useMemo } from "react";
import { GlassPanel, Kbd, cx, focusRing } from "@/ui";
import { useVisibility } from "./aiStore";
import { typeOf, useCommandContext, useWs, wsGet } from "./bridge";
import { cmdReviewSuggestions } from "./review";
import { boundsOf, outlineOf, targetOf, visibleSuggestions } from "./suggestions";

/** R-FA4: one chip, under the target (the mockup's "✦ type · 87% · Accept A · Reject X"). */
export function SuggestionChip() {
  const projectId = useWs((s) => s.projectId);
  const boxes = useWs((s) => s.boxes);
  const order = useWs((s) => s.order);
  const focused = useWs((s) => s.focusedSuggestionId);
  const view = useWs((s) => s.view);
  const interacting = useWs((s) => s.interacting);
  const vis = useVisibility();
  const ctx = useCommandContext(projectId ?? "");
  const target = useMemo(
    () => targetOf(visibleSuggestions(boxes, order, vis), focused),
    [boxes, order, vis, focused],
  );
  if (!target || interacting || !projectId) return null;
  const b = boundsOf(outlineOf(target));
  const left = b.x * view.scale + view.x;
  const top = (b.y + b.h) * view.scale + view.y + 6;
  const type = typeOf(wsGet(), target.class_id);
  const act = (action: "accept" | "reject") => void cmdReviewSuggestions(ctx, [target.id], action);
  const btn = cx("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 hover:bg-hover", focusRing);
  return (
    <GlassPanel
      variant="float"
      radius="control"
      data-testid="suggestion-chip"
      className="pointer-events-auto absolute z-10 flex items-center gap-2 px-2 py-1 text-xs"
      style={{ left, top }}
    >
      <span className="text-ok" aria-hidden>
        ✦
      </span>
      <span>{type?.name ?? "Unknown type"}</span>
      <span className="font-mono tabular-nums">{Math.round((target.confidence ?? 1) * 100)}%</span>
      <button type="button" className={btn} onClick={() => act("accept")} aria-label="Accept (A)">
        Accept <Kbd>A</Kbd>
      </button>
      <button type="button" className={btn} onClick={() => act("reject")} aria-label="Reject (X)">
        Reject <Kbd>X</Kbd>
      </button>
    </GlassPanel>
  );
}
