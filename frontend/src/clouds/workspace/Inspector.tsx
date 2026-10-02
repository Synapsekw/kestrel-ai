import type { ReactNode } from "react";
import { GlassPanel, stagger } from "@/ui";
import { INSPECTOR_WIDTH } from "./layout";

/**
 * The inspector (workspace-rail spec §3.2): the selected finding or measurement only; the lists
 * live in the rail. Right 14, top 14, bottom 204 (above the minimap), DESIGN.md's 340 wide.
 */
export function Inspector({ detail }: { detail: ReactNode | null }) {
  if (!detail) return null;
  return (
    <GlassPanel
      variant="float"
      radius="panel"
      as="aside"
      aria-label="Inspector"
      data-testid="cloud-inspector"
      style={{ ...stagger(2), width: INSPECTOR_WIDTH }}
      className="stagger absolute bottom-[204px] right-3.5 top-3.5 z-10 flex flex-col overflow-hidden animate-slide-in reduce-motion:animate-none"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">{detail}</div>
    </GlassPanel>
  );
}
