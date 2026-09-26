import type { DesignPreview } from "@/api/designSurfaces";
import { Alert, Button, Checkbox } from "@/ui";
import { formatPct } from "./designImport";

function signed(x: number): string {
  return `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)} m`;
}

export function DesignCheck({
  preview,
  imageUrl,
  accepted,
  onAccept,
  onApply,
  busy,
}: {
  preview: DesignPreview;
  imageUrl: string;
  accepted: boolean;
  onAccept: (v: boolean) => void;
  onApply: (patch: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const hasWarn = preview.warnings.some((w) => w.level === "warn");
  const hasBlock = preview.warnings.some((w) => w.level === "block");
  const out = preview.output;
  const z = preview.z_check;
  return (
    <div className="flex flex-col gap-3">
      {out && (
        <img
          src={imageUrl}
          alt="The design over the cloud surface"
          className="max-h-80 w-full rounded bg-bg object-contain"
        />
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
        <dt className="text-muted">Design on the cloud surface</dt>
        <dd>{formatPct(preview.overlap_fraction)}</dd>
        <dt className="text-muted">Cloud surface covered</dt>
        <dd>{formatPct(preview.target_covered_fraction)}</dd>
        <dt className="text-muted">Height difference (median, P5 … P95)</dt>
        <dd>{z ? `${signed(z.median_dz_m)} (${signed(z.p05_dz_m)} … ${signed(z.p95_dz_m)})` : "—"}</dd>
        <dt className="text-muted">Output grid</dt>
        <dd>
          {out
            ? `${out.width.toLocaleString()} × ${out.height.toLocaleString()} cells at ${out.cell_size_m} m`
            : "—"}
        </dd>
        <dt className="text-muted">Triangles</dt>
        <dd>{preview.triangle_count !== null ? preview.triangle_count.toLocaleString() : "—"}</dd>
      </dl>
      {preview.warnings.map((w, i) => (
        <Alert
          key={`${w.code}-${i}`}
          tone={w.level === "block" ? "danger" : w.level === "warn" ? "warn" : "info"}
        >
          {w.message}
        </Alert>
      ))}
      {preview.suggestions.map((s) => (
        <Alert
          key={s.code}
          tone="info"
          title="Suggestion"
          actions={
            <Button size="sm" disabled={busy} onClick={() => onApply(s.options_patch)}>
              Apply
            </Button>
          }
        >
          {s.message}
        </Alert>
      ))}
      {hasWarn && !hasBlock && (
        <Checkbox
          label="Import despite these warnings"
          checked={accepted}
          onChange={(e) => onAccept(e.target.checked)}
        />
      )}
    </div>
  );
}
