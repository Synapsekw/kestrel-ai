import { Line } from "react-konva";
import type { OverlayRing } from "./nav";

/** The finding's shapes, filled in severity colours (data colours) at the slider's opacity. */
export function InspectOverlay({ rings, opacity }: { rings: readonly OverlayRing[]; opacity: number }) {
  return (
    <>
      {rings.map((r) => (
        <Line
          key={r.id}
          points={r.points}
          closed
          fill={r.colour}
          stroke={r.colour}
          strokeWidth={2}
          strokeScaleEnabled={false}
          opacity={opacity}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </>
  );
}
