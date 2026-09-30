import type { Finding } from "@/api/findings";
import type { OverviewSite } from "@/api/overview";
import type { CSSProperties } from "react";
import { cx, GlassPanel, severityOf, useSeverityScale } from "@/ui";
import { niceScale, siteFrame } from "./siteGeometry";

/** Spec 2026-09-30-project-landing §5.3 and D8: where the site is, drawn from our own geometry (no basemap). */
export function SiteLocation({
  site,
  pins,
  className,
}: {
  site: OverviewSite;
  pins: Finding[];
  className?: string;
}) {
  const scale = useSeverityScale();
  const frame = siteFrame(site);
  if (!frame) return null;
  const [minlon, minlat, maxlon, maxlat] = site.bounds_wgs84!;
  const a = frame.project(minlon, maxlat);
  const z = frame.project(maxlon, minlat);
  const bar = niceScale(frame.width * frame.metresPerUnit);
  const barUnits = bar.metres / frame.metresPerUnit;
  const dot = frame.height / 90;
  const located = pins.filter((p) => p.lon != null && p.lat != null);
  const ha = site.area_m2 != null ? `≈ ${(site.area_m2 / 10_000).toFixed(1)} ha` : null;
  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-label="Location"
      className={cx("flex min-h-0 flex-col p-3", className)}
    >
      <h2 className="flex justify-between text-xs text-muted">
        <span>Location</span>
        {ha && <span className="font-mono text-2xs text-dim">{ha}</span>}
      </h2>
      <svg
        role="img"
        aria-label="Site location"
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="mt-2 min-h-0 w-full flex-1"
      >
        <rect
          data-testid="site-outline"
          x={a.x}
          y={a.y}
          width={Math.max(z.x - a.x, dot)}
          height={Math.max(z.y - a.y, dot)}
          className="fill-accent/10 stroke-accent"
          strokeWidth={dot / 3}
          strokeDasharray={`${dot} ${dot / 1.5}`}
        />
        {site.photo_points.map(([lon, lat], i) => {
          const p = frame.project(lon, lat);
          return (
            <circle
              key={i}
              data-testid="photo-point"
              cx={p.x}
              cy={p.y}
              r={dot / 2.5}
              className="fill-accent"
              opacity={0.6}
            />
          );
        })}
        {located.map((f) => {
          const p = frame.project(f.lon!, f.lat!);
          const colour = severityOf(scale, f.severity)?.colour;
          return (
            <circle
              key={f.id}
              data-testid="site-pin"
              cx={p.x}
              cy={p.y}
              r={dot * 1.4}
              className={cx(colour ? "fill-[color:var(--c)]" : "fill-muted", "stroke-bg")}
              strokeWidth={dot / 2}
              style={colour ? ({ "--c": colour } as CSSProperties) : undefined}
            />
          );
        })}
        <g transform={`translate(${frame.width * 0.04} ${frame.height * 0.94})`}>
          <rect width={barUnits} height={dot / 2} className="fill-ink" />
        </g>
      </svg>
      <p className="mt-1 font-mono text-2xs text-dim">{bar.label}</p>
    </GlassPanel>
  );
}
