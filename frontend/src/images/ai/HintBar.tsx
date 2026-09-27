import { useMemo } from "react";
import { GlassPanel, Kbd } from "@/ui";
import { useVisibility } from "./aiStore";
import { useWs } from "./bridge";
import { clampThreshold } from "./threshold";
import { ConfidenceFloor } from "./ConfidenceFloor";
import { hiddenCount, visibleSuggestions } from "./suggestions";

/**
 * Bottom-centre float while suggestions are pending (spec §6.2, §11.4). Purely presentational: the
 * Shift+A / Shift+X confirm lives in `AiHosts`, which FW mounts unconditionally.
 */
export function HintBar() {
  const boxes = useWs((s) => s.boxes);
  const order = useWs((s) => s.order);
  const vis = useVisibility();
  const setThreshold = useWs((s) => s.setThreshold); // FC's; FA's useAiWorkspace persists it
  const visible = useMemo(() => visibleSuggestions(boxes, order, vis).length, [boxes, order, vis]);
  const hidden = useMemo(() => hiddenCount(boxes, order, vis.threshold), [boxes, order, vis.threshold]);
  const show = vis.show && visible + hidden > 0;
  return show ? (
    <GlassPanel
      variant="float"
      radius="control"
      data-testid="ai-hint-bar"
      className="animate-rise pointer-events-auto absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 px-3 py-1.5 text-sm reduce-motion:animate-none"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-ok" aria-hidden />
      <span>
        {visible} AI {visible === 1 ? "suggestion" : "suggestions"} on this image
      </span>
      <span className="flex items-center gap-1 text-muted">
        <Kbd>A</Kbd>
        <span>accept</span>
      </span>
      <span className="flex items-center gap-1 text-muted">
        <Kbd>X</Kbd>
        <span>reject</span>
      </span>
      <span className="flex items-center gap-1 text-muted">
        <Kbd>Tab</Kbd>
        <span>next</span>
      </span>
      <ConfidenceFloor
        value={vis.threshold}
        hidden={hidden}
        onChange={(v) => setThreshold(clampThreshold(v))}
        inline
      />
    </GlassPanel>
  ) : null;
}
