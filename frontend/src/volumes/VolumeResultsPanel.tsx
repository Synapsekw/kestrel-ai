import { Link } from "react-router-dom";
import type { Surface, VolumeMeasurement } from "@contract/client";
import { Alert, Button, Disclosure, buttonClass } from "@/ui";
import { formatM2, formatM3, labels, uncertaintyText, viewIn3dHref, worstTone } from "./model";

const ALIGNMENT_CODES = new Set([
  "stable_area_small",
  "no_stable_area",
  "alignment_offset",
  "alignment_datum",
  "alignment_noisy",
  "alignment_tilt",
]);

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="contents">
      <dt className="text-muted">{k}</dt>
      <dd
        className={
          strong ? "text-right font-semibold tabular-nums text-ink" : "text-right tabular-nums text-ink"
        }
      >
        {v}
      </dd>
    </div>
  );
}

/**
 * The Results tab (spec section 9): the numbers labelled for the base kind, net and its ±, the
 * areas, the alignment verdict, the base fit, "How sure is this?" and the warnings; "View in 3D"
 * opens the cloud at the polygon, "Export…" the export dialog.
 */
export function VolumeResultsPanel({
  projectId,
  measurement: m,
  top,
  onExport,
}: {
  projectId: string;
  measurement: VolumeMeasurement;
  top: Surface;
  onExport: () => void;
}) {
  const r = m.results;
  if (!r) {
    return (
      <p className="text-sm text-muted">
        {m.status === "failed" ? m.error : "Calculate to see the volumes."}
      </p>
    );
  }
  const lab = labels(m.base.kind, r.base_surface);
  const u = r.uncertainty;
  const alignment = r.warnings.filter((w) => ALIGNMENT_CODES.has(w.code));
  const other = r.warnings.filter((w) => !ALIGNMENT_CODES.has(w.code));
  const share = r.area_m2 ? r.nodata_area_m2 / r.area_m2 : 0;
  const href = viewIn3dHref(projectId, top, m.polygon_native);
  const tone = worstTone(alignment);
  return (
    <div className="flex flex-col gap-4" data-testid="results-panel">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
        <Row k={lab.fill} v={formatM3(r.fill_m3)} strong={lab.headline !== "net"} />
        <Row k={lab.cut} v={formatM3(r.cut_m3)} strong={lab.headline === "both"} />
        <Row k="Net" v={formatM3(r.net_m3)} strong={lab.headline === "net"} />
      </dl>
      <p className="text-sm text-ink">{uncertaintyText(u)}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs" aria-label="Areas">
        <Row k="Polygon" v={formatM2(r.polygon_area_m2)} />
        <Row k="Measured" v={formatM2(r.measured_area_m2)} />
        <Row k="Patched (machines)" v={formatM2(r.masked_area_m2)} />
        <Row k="Excluded" v={formatM2(r.excluded_area_m2)} />
        <Row k="No data" v={`${formatM2(r.nodata_area_m2)} (${(share * 100).toFixed(1)} %)`} />
      </dl>
      {m.base.kind === "surface" && (
        <Alert tone={tone === "ok" ? "ok" : tone} title="Alignment">
          {r.alignment
            ? `Median dZ ${r.alignment.median_dz.toFixed(3)} m on ${r.alignment.n_cells.toLocaleString("en-GB")} stable cells; ` +
              `shift applied ${r.shift_applied_m.toFixed(3)} m.`
            : "No usable stable area."}
          {alignment.map((w) => (
            <span key={w.code} className="block">
              {w.message}
            </span>
          ))}
        </Alert>
      )}
      {r.base_fit && m.base.kind !== "surface" && (
        <p className="text-xs text-muted">
          Base fitted to {r.base_fit.samples} edge samples ({r.base_fit.rejected} rejected), RMS{" "}
          {r.base_fit.rms_m.toFixed(3)} m; {(r.base_fit.usable_edge_fraction * 100).toFixed(0)} % of the edge
          usable.
        </p>
      )}
      <Disclosure label="How sure is this?">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 pt-2 text-xs">
          <Row k="Base" v={formatM3(u.base_m3)} />
          <Row k="Alignment" v={formatM3(u.alignment_m3)} />
          <Row k="Cell size" v={formatM3(u.cell_size_m3)} />
          <Row k="No data" v={formatM3(u.nodata_m3)} />
          <Row k="Patches" v={formatM3(u.patch_m3)} />
          <Row k="Total (indicative)" v={formatM3(u.total_m3)} strong />
        </dl>
        <p className="pt-2 text-xs text-muted">
          Not included: the survey&apos;s own georeferencing accuracy. Heights are as stored in the cloud;
          grid areas differ from ground areas by a factor of {r.areal_scale_factor.toFixed(5)}.
        </p>
      </Disclosure>
      {other.map((w) => (
        <Alert key={w.code} tone={w.severity === "danger" ? "danger" : "warn"}>
          {w.message}
        </Alert>
      ))}
      <div className="flex gap-2">
        {href ? (
          <Link to={href} className={buttonClass("secondary", "sm")}>
            View in 3D
          </Link>
        ) : (
          <Button size="sm" disabled title="This surface has no point cloud to open">
            View in 3D
          </Button>
        )}
        <Button size="sm" icon="download" onClick={onExport}>
          Export…
        </Button>
      </div>
    </div>
  );
}
