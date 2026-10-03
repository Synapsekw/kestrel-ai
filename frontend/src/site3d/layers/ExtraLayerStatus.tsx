import type { ExtraLayerRow } from "./useSiteExtraLayers";
import { statusText } from "./status";

/** For screen readers until S3's Layers panel shows the same lines on screen (S3 removes this). */
export function ExtraLayerStatus({ rows }: { rows: readonly ExtraLayerRow[] }) {
  return (
    <ul aria-label="Layer status" className="sr-only">
      {rows.map((r) => (
        <li key={r.id}>{`${r.label}: ${statusText(r.layer.status.get(), r.visible)}`}</li>
      ))}
    </ul>
  );
}
