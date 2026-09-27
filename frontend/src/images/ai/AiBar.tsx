import { GlassPanel, Progress, StatusDot } from "@/ui";
import { useAiStore } from "./aiStore";

/** Top-centre, only while detecting (spec §6.2). The dot and bar loop only while the request is open (A6). */
export function AiBar() {
  const detect = useAiStore((s) => s.detect);
  if (!detect) return null;
  return (
    <GlassPanel
      variant="float"
      radius="control"
      role="status"
      data-testid="ai-bar"
      className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-3 px-3 py-1.5 text-sm"
    >
      <StatusDot status="running" live label="Detecting" />
      <span>{detect.modelName} · detecting…</span>
      <Progress running thin label="Detection in progress" className="w-32" />
    </GlassPanel>
  );
}
