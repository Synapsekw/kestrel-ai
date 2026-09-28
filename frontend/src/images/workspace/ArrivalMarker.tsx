/* eslint-disable react-refresh/only-export-components --
   markerSpec is exported next to the components it draws for; not a fast-refresh boundary. */
import { Circle, Group } from "react-konva";
import { Link } from "react-router-dom";
import { GlassPanel } from "@/ui";
import { useArrivalStore, type Marker } from "./arrivalStore";

const RING_PX = 2;
const DOT_PX = 3;

/** Canvas colours come from the tokens (DESIGN.md); Konva needs a string, not a class. */
function accent(alpha = 1): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const [r, g, b] = raw.split(/\s+/).map(Number);
  return Number.isFinite(r) ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgba(157, 139, 255, ${alpha})`;
}

/** Ruling 8: radius r in image px; stroke, dash and dot in screen px (divide by the zoom). */
export function markerSpec(m: Marker, scale: number) {
  return {
    ring: {
      x: m.px,
      y: m.py,
      radius: m.r,
      dash: [6 / scale, 4 / scale] as [number, number],
      strokeWidth: RING_PX,
    },
    dot: { x: m.px, y: m.py, radius: DOT_PX / scale },
  };
}

function useMarkerFor(imageId: string): Marker | null {
  const owner = useArrivalStore((s) => s.imageId);
  const marker = useArrivalStore((s) => s.marker);
  return owner === imageId ? marker : null;
}

/** §6.5: the static arrival ring on the interaction layer. No pulse (A6); never saved.
 * Amendment (item 9): a back-only arrival has a null marker, so this renders nothing. */
export function ArrivalMarker({ imageId, scale }: { imageId: string; scale: number }) {
  const marker = useMarkerFor(imageId);
  if (!marker) return null;
  const { ring, dot } = markerSpec(marker, scale);
  return (
    <Group listening={false} name="arrival-marker">
      <Circle {...ring} stroke={accent()} strokeScaleEnabled={false} />
      <Circle {...dot} fill={accent()} />
    </Group>
  );
}

/** A hidden DOM stand-in, because Konva draws into a canvas: tests and I-E's e2e assert on it.
 * Amendment (item 9): renders nothing without a marker (a back-only arrival). */
export function ArrivalProbe({ imageId }: { imageId: string }) {
  const marker = useMarkerFor(imageId);
  if (!marker) return null;
  return (
    <span
      hidden
      data-testid="arrival-marker"
      data-at={`${marker.px},${marker.py}`}
      data-r={String(marker.r)}
    />
  );
}

/** §6.5: under the info chip, back to the cloud the operator came from.
 * Amendment (item 9): shows whenever `cloudId` is set for this image, marker or not. */
export function BackTo3DChip({ projectId, imageId }: { projectId: string; imageId: string }) {
  const owner = useArrivalStore((s) => s.imageId);
  const cloudId = useArrivalStore((s) => s.cloudId);
  if (owner !== imageId || !cloudId) return null;
  return (
    <GlassPanel
      variant="float"
      className="absolute left-16 top-14 z-10 px-2.5 py-1 text-xs animate-reveal reduce-motion:animate-none"
    >
      <Link to={`/p/${projectId}/clouds/${cloudId}`} className="font-medium text-accent-ink hover:underline">
        Back to 3D
      </Link>
    </GlassPanel>
  );
}
