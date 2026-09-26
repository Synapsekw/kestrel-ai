import { useState } from "react";
import { GlassPanel } from "@/ui/GlassPanel";

export const title = "Glass";
export const order = 10;

const IMAGERY = "linear-gradient(135deg,#6b5c9c,#2f5f73)";
const TEXTURE = "repeating-linear-gradient(45deg,rgba(255,255,255,.08) 0 8px,transparent 8px 16px)";

export default function GlassSection() {
  const [reduced, setReduced] = useState(false);
  const toggle = () => {
    const next = !reduced;
    setReduced(next);
    document.documentElement.dataset.effects = next ? "reduced" : "full";
  };
  return (
    <div className="grid gap-4">
      <button type="button" onClick={toggle} className="w-fit text-sm text-accent-ink underline">
        {reduced ? "Show full effects" : "Show reduced effects"}
      </button>
      <div className="grid grid-cols-3 gap-4">
        <GlassPanel className="p-4">
          <p className="text-xs text-muted">pane</p>
          <p className="mt-2 text-lg">Translucent, no blur</p>
        </GlassPanel>
        <GlassPanel interactive className="p-4">
          <p className="text-xs text-muted">pane · interactive</p>
          <p className="mt-2 text-lg">Hover lifts 2px</p>
        </GlassPanel>
        <div className="relative h-40 overflow-hidden rounded-panel" style={{ background: IMAGERY }}>
          <div className="absolute inset-0" style={{ background: TEXTURE }} />
          <GlassPanel variant="float" className="absolute left-3 top-3 px-3 py-2 text-xs">
            float over imagery
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
