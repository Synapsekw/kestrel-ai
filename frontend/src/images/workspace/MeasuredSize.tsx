import type { Box } from "@contract/client";
import type { ImageCamera } from "@/api/images";
import { Button } from "@/ui";
import { basisText, PX_ONLY } from "./measureText";
import { measureShape, scaleFromCamera } from "./seams";

export interface MeasuredSizeProps {
  shape: Pick<Box, "shape" | "w" | "h" | "points">;
  camera: ImageCamera | null | undefined;
  /** Ruling 9: "Set distance…" when there is no trustworthy distance. */
  onSetDistance?: () => void;
}

/**
 * FindingInspector's measureSlot (§6.3, §9.3): FC's tiles, then the GSD, ± and distance source.
 * FC's `measureShape(...).basis` has no source label (task-1 seams header); Ruling 9 wants the
 * source named under every mm figure, so this renders FW's `basisText(scale)` instead of `t.basis`.
 */
export function MeasuredSize({ shape, camera, onSetDistance }: MeasuredSizeProps) {
  const scale = scaleFromCamera(camera);
  const t = measureShape(shape, scale);
  if (t.pointMarker)
    return (
      <p data-testid="measured-size" className="text-xs text-muted">
        Point marker
      </p>
    );
  const tiles = [t.primary, ...t.secondary].filter((v): v is NonNullable<typeof v> => v !== null);
  return (
    <div data-testid="measured-size" className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((v) => (
          <div
            key={v.label}
            className="flex flex-col gap-0.5 rounded-control border border-line bg-surface-2 px-2 py-1.5"
          >
            <span className="font-mono text-sm font-semibold tabular-nums text-ink">{v.value}</span>
            <span className="text-xs text-muted">
              {v.label}
              {v.sigma ? ` · ${v.sigma}` : ""}
            </span>
          </div>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
        {scale ? basisText(scale) : PX_ONLY}
        {!scale && onSetDistance && (
          <Button size="sm" variant="ghost" onClick={onSetDistance}>
            Set distance…
          </Button>
        )}
      </p>
    </div>
  );
}
