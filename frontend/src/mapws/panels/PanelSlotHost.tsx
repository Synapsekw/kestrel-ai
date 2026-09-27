import { useRegistry } from "../registry";
import type { SiteFrame } from "../types";
import { panelRegistry, type PanelSlot } from "./panelRegistry";

const WRAP: Record<Exclude<PanelSlot, "coords-extra">, string> = {
  "top-center":
    "pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center [&>*]:pointer-events-auto",
  "bottom-center":
    "pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center [&>*]:pointer-events-auto",
  "bottom-right": "absolute bottom-4 right-4 z-10",
  stage: "pointer-events-none absolute inset-0 z-[5]",
};

/** Renders the panel plugins of one slot (W2's compare, timeline, minimap, Z readout, stage overlays). */
export function PanelSlotHost({
  slot,
  projectId,
  frame,
}: {
  slot: PanelSlot;
  projectId: string;
  frame: SiteFrame;
}) {
  const panels = useRegistry(panelRegistry)
    .filter((p) => p.slot === slot)
    .sort((a, b) => a.order - b.order);
  if (panels.length === 0) return null;
  const body = panels.map((p) => <p.Component key={p.id} projectId={projectId} frame={frame} />);
  if (slot === "coords-extra") return <>{body}</>;
  return <div className={WRAP[slot]}>{body}</div>;
}
