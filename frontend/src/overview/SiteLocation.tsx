import type { Finding } from "@/api/findings";
import type { OverviewSite } from "@/api/overview";
import type { BasemapSource } from "@contract/client";
import { useId, useState, type CSSProperties } from "react";
import { cx, GlassPanel, Segmented, severityOf, useSeverityScale } from "@/ui";
import { basemapTiles } from "./basemapTiles";
import { formatCoords } from "./kpis";
import { niceScale, siteFrame } from "./siteGeometry";

const SOURCE_KEY = "kestrel.overview.basemap";
const SOURCES = [
  { value: "satellite" as const, label: "Satellite" },
  { value: "streets" as const, label: "Map" },
];
// Both providers require it while their tiles are on screen (spec 2026-10-02-site-basemap B5).
const ATTRIBUTION: Record<BasemapSource, string> = {
  satellite: "© Esri, Maxar, Earthstar Geographics",
  streets: "© OpenStreetMap contributors",
};

function storedSource(): BasemapSource {
  try {
    return localStorage.getItem(SOURCE_KEY) === "streets" ? "streets" : "satellite";
  } catch {
    return "satellite";
  }
}

/**
 * Spec 2026-09-30-project-landing §5.3 and D8: where the site is, drawn from our own geometry. Spec
 * 2026-10-02-site-basemap: with `basemapUrl` (a `{z}/{x}/{y}` template per source), keyless tiles
 * cached by the backend lie underneath; a tile that fails (offline) is simply left out.
 */
export function SiteLocation({
  site,
  pins,
  basemapUrl,
  className,
}: {
  site: OverviewSite;
  pins: Finding[];
  basemapUrl?: (source: BasemapSource) => string;
  className?: string;
}) {
  const scale = useSeverityScale();
  const clipId = useId();
  const [source, setSource] = useState<BasemapSource>(storedSource);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const frame = siteFrame(site);
  if (!frame) return null;
  const template = basemapUrl?.(source);
  const tiles = template
    ? basemapTiles(frame)
        .map((t) => ({
          ...t,
          href: template.replace("{z}", `${t.z}`).replace("{x}", `${t.x}`).replace("{y}", `${t.y}`),
        }))
        .filter((t) => !failed.has(t.href))
    : [];
  const choose = (next: BasemapSource) => {
    setSource(next);
    try {
      localStorage.setItem(SOURCE_KEY, next);
    } catch {
      // A blocked storage only costs remembering the choice.
    }
  };
  const [minlon, minlat, maxlon, maxlat] = site.bounds_wgs84!;
  const a = frame.project(minlon, maxlat);
  const z = frame.project(maxlon, minlat);
  const bar = niceScale(frame.width * frame.metresPerUnit);
  const barUnits = bar.metres / frame.metresPerUnit;
  const dot = frame.height / 90;
  const located = pins.filter((p) => p.lon != null && p.lat != null);
  const hectares = site.area_m2 != null ? (site.area_m2 / 10_000).toFixed(1) : null;
  const ha = hectares != null ? `≈ ${hectares} ha` : null;
  const [clon, clat] = site.center ?? [(minlon + maxlon) / 2, (minlat + maxlat) / 2];
  const label = ["Site location", formatCoords(clon, clat), hectares != null && `about ${hectares} ha`]
    .filter(Boolean)
    .join(", ");
  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-label="Location"
      className={cx("flex min-h-0 flex-col p-3", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-xs text-muted">
          <span>Location</span>
          {ha && <span className="font-mono text-2xs text-dim">{ha}</span>}
        </h2>
        {basemapUrl && (
          <Segmented size="sm" label="Basemap" options={SOURCES} value={source} onChange={choose} />
        )}
      </div>
      <div className="relative mt-2 min-h-0 flex-1">
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${frame.width} ${frame.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
        >
          {template && (
            <g data-testid="basemap" clipPath={`url(#${clipId})`}>
              <clipPath id={clipId}>
                <rect width={frame.width} height={frame.height} />
              </clipPath>
              {tiles.map((t) => (
                <image
                  key={t.href}
                  data-testid="basemap-tile"
                  href={t.href}
                  x={t.left}
                  y={t.top}
                  width={t.width}
                  height={t.height}
                  preserveAspectRatio="none"
                  onError={() => setFailed((s) => new Set(s).add(t.href))}
                />
              ))}
            </g>
          )}
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
                r={dot / 1.8}
                className="fill-accent"
                opacity={0.85}
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
            <rect data-testid="scale-bar" width={barUnits} height={dot / 2} className="fill-ink" />
            {/* In the drawing, beside its bar: letterboxing moves both together. */}
            <text
              data-testid="scale-label"
              x={barUnits + dot * 1.5}
              y={dot / 4}
              dominantBaseline="middle"
              fontSize={dot * 3.2}
              className="fill-muted font-mono"
            >
              {bar.label}
            </text>
          </g>
        </svg>
        {tiles.length > 0 && (
          <span className="absolute bottom-0 right-0 rounded-sm bg-bg/70 px-1 text-2xs text-dim">
            {ATTRIBUTION[source]}
          </span>
        )}
      </div>
    </GlassPanel>
  );
}
