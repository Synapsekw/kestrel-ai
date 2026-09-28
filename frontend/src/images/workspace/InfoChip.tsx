import type { ImageDetail } from "@/api/images";
import { Button, GlassPanel } from "@/ui";

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function infoChipText(d: ImageDetail): { parts: string[]; gsd: string | null } {
  const parts = [d.file_name];
  if (d.capture_time) parts.push(`Captured ${dateTime.format(new Date(d.capture_time))}`);
  if (d.lat != null && d.lon != null) parts.push(`${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}`);
  if (d.camera.rel_alt != null) parts.push(`Alt ${d.camera.rel_alt.toFixed(1)} m AGL`);
  const gsd =
    d.camera.gsd_mm != null && d.camera.distance_source !== "none"
      ? `GSD ${d.camera.gsd_mm.toFixed(1)} mm/px`
      : null;
  return { parts, gsd };
}

/** §6.2: file · captured · lat/lon · altitude · GSD, at the top of the canvas after the palette. */
export function InfoChip({
  detail,
  onSetDistance,
}: {
  detail: ImageDetail | null;
  onSetDistance: () => void;
}) {
  if (!detail) return null;
  const { parts, gsd } = infoChipText(detail);
  return (
    <GlassPanel
      variant="float"
      data-testid="image-info-chip"
      className="absolute left-16 top-3 z-10 flex max-w-[60%] items-center gap-2 truncate px-3 py-1.5 font-mono text-xs text-ink"
    >
      <span className="truncate">{parts.join(" · ")}</span>
      <span aria-hidden="true">·</span>
      {gsd ?? (
        <>
          GSD —
          <Button size="sm" variant="ghost" onClick={onSetDistance}>
            Set distance…
          </Button>
        </>
      )}
    </GlassPanel>
  );
}
