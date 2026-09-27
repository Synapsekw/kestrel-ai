import { GlassPanel } from "@/ui";
import { useWorkspace } from "../context";
import { useRegistry } from "../registry";
import type { SiteFrame } from "../types";
import { inspectorRegistry } from "./inspectorRegistry";

const PLACE = "absolute right-4 top-4 z-10 flex max-h-[calc(100%-150px)] w-[318px] flex-col";

/** Spec §5.3 shell: the registered inspector of the selection kind, or nothing (R-W1-11). */
export function InspectorHost({ projectId, frame }: { projectId: string; frame: SiteFrame }) {
  const selection = useWorkspace((s) => s.selection);
  const select = useWorkspace((s) => s.select);
  const kinds = useRegistry(inspectorRegistry);
  if (!selection) return null;
  const kind = kinds.find((k) => k.id === selection.kind);
  if (!kind) return null;
  const body = (
    <kind.Body
      key={`${selection.kind}:${selection.id}`}
      selection={selection}
      projectId={projectId}
      frame={frame}
      onClose={() => select(null)}
    />
  );
  const sel = `${selection.kind}:${selection.id}`;
  if (!kind.framed)
    return (
      <div data-testid="map-inspector" data-sel={sel} className={PLACE}>
        {body}
      </div>
    );
  return (
    <GlassPanel
      as="aside"
      variant="float"
      radius="panel"
      aria-label={kind.label}
      style={{ scrollbarWidth: "none" }}
      data-testid="map-inspector"
      data-sel={sel}
      className={`${PLACE} overflow-y-auto p-3.5 animate-slide-in reduce-motion:animate-none`}
    >
      {body}
    </GlassPanel>
  );
}
