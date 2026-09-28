import type { ImageCamera } from "@/api/images";
import { GlassPanel } from "@/ui";
import { lengthReadout } from "./measureText";
import { scaleFromCamera, useActiveMeasurement } from "./seams";

/** §9.3, §18 item 5: the L tool's length in mm ± σ with its distance source (E's `measure-readout`). */
export function MeasureReadout({ camera }: { camera: ImageCamera | null | undefined }) {
  const seg = useActiveMeasurement();
  if (!seg) return null;
  const px = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  return (
    <GlassPanel
      variant="float"
      data-testid="measure-readout"
      className="absolute bottom-3 left-3 z-10 px-3 py-1.5 font-mono text-xs text-ink"
    >
      {lengthReadout(px, scaleFromCamera(camera))}
    </GlassPanel>
  );
}
