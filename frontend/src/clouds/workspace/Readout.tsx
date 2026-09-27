import type { PointCloud } from "@/api/clouds";
import type { CloudPick } from "@/clouds/CloudViewer";
import { formatLength } from "@/clouds/readout";
import { WARN_UNCERTAINTY_M } from "@/clouds/viewer/uncertainty";
import { GlassPanel, IconButton, cx, stagger } from "@/ui";
import { READOUT_BAND } from "./layout";

/**
 * The pick readout (spec §6: bottom 14, centred pill): E, N, Z to 2 decimals, the spacing u (warn
 * above 0.10 m), the CRS; "—" with none. "Show on map" (S1) sits at its end (plan Ruling 7).
 */
export function Readout({
  cloud,
  pick,
  onShowOnMap,
}: {
  cloud: PointCloud;
  pick: CloudPick | null;
  onShowOnMap?: () => void;
}) {
  const warn = !!pick && pick.uncertainty_m > WARN_UNCERTAINTY_M;
  const values: [string, number | undefined][] = [
    ["E", pick?.x],
    ["N", pick?.y],
    ["Z", pick?.z],
  ];
  // A pointer-transparent row across the viewport's bottom: three grid columns, the outer two at
  // least READOUT_BAND.left / .right wide (the gizmo's and the minimap's real sizes plus a gap) and
  // otherwise equal. So the pill sits at the viewport's centre when there is room (spec §6) and moves
  // aside rather than run under the gizmo or the minimap (the minimap would take "Show on map"'s
  // click). Dense (gap-x-2, px-3) so a pick with "Show on map" fits one line at 1280 px; narrower
  // than that the pill wraps its items. No transform centring: animate-reveal animates transform.
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-3.5 z-10 grid"
      style={{
        gridTemplateColumns: `minmax(${READOUT_BAND.left}px, 1fr) minmax(0, max-content) minmax(${READOUT_BAND.right}px, 1fr)`,
      }}
    >
      <span aria-hidden />
      <GlassPanel
        variant="float"
        aria-label="Pick readout"
        data-testid="cloud-readout"
        style={stagger(4)}
        className="stagger pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 whitespace-nowrap rounded-full px-3 py-2 text-xs animate-reveal reduce-motion:animate-none"
      >
        <span aria-hidden className={cx("h-[7px] w-[7px] rounded-full", pick ? "bg-ok" : "bg-dim")} />
        {values.map(([k, v]) => (
          <span key={k}>
            <span className="mr-1 text-dim">{k}</span>
            <span className="inline-block min-w-[76px] font-mono tabular-nums text-ink">
              {v === undefined ? "—" : v.toFixed(2)}
            </span>
          </span>
        ))}
        <span aria-hidden className="h-4 w-px bg-line" />
        <span>
          <span className="mr-1 text-dim">Spacing</span>
          <span className={cx("font-mono", warn ? "text-warn" : "text-ink")}>
            {pick ? formatLength(pick.uncertainty_m) : "—"}
          </span>
        </span>
        <span aria-hidden className="h-4 w-px bg-line" />
        <span className="text-dim">{cloud.epsg ? `EPSG:${cloud.epsg} · m` : "No CRS · m"}</span>
        {onShowOnMap && <IconButton size="sm" icon="map" label="Show on map" onClick={onShowOnMap} />}
      </GlassPanel>
    </div>
  );
}
