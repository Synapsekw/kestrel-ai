import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import type OlMap from "ol/Map";
import { mapTileUrl, type GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listFindings } from "@/api/findings";
import { fetchMap } from "@/api/maps";
import { pushLog } from "@/app/diagnostics";
import { AddDataButton } from "@/data/AddDataButton";
import { formatFindingNumber } from "@/findings/format";
import { findingPath } from "@/findings/links";
import { topLevel } from "@/findings/severity";
import { scaleBar, toOl } from "@/maps/grid";
import { MapView } from "@/maps/MapView";
import { useChangesStore } from "@/store/changes";
import {
  cx,
  EmptyState,
  focusRing,
  GlassPanel,
  Skeleton,
  stagger,
  useSeverityScale,
  type SeverityLevel,
} from "@/ui";
import {
  backdropLayout,
  HERO_PIN_LIMIT,
  lonLatToMapPixel,
  pinsFromFindings,
  type PinInput,
} from "./heroPins";
import "./overview.css";

/** A burst of `findings.changed` events re-reads the pins once, like the Overview's other reads. */
const REFRESH_DEBOUNCE_MS = 400;

interface Placed {
  pin: PinInput;
  left: string;
  top: string;
}

function Pin({
  projectId,
  placed,
  index,
  scale,
  topLevelNo,
}: {
  projectId: string;
  placed: Placed;
  index: number;
  scale: readonly SeverityLevel[];
  /** The scale's highest level, worked out once for all pins; null for an empty scale. */
  topLevelNo: number | null;
}) {
  const level = scale.find((l) => l.level === placed.pin.severity);
  const top = level !== undefined && level.level === topLevelNo;
  const label = `${formatFindingNumber(placed.pin.number)} · ${level?.name ?? "No severity"}`;
  return (
    <Link
      to={findingPath(projectId, placed.pin.id)}
      aria-label={label}
      title={label}
      className={cx(
        "ov-pin absolute z-[2] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-ink bg-[color:var(--c)] hover:z-[3] focus-visible:z-[3]",
        // DESIGN.md: the most severe pins get a thicker ring, never a pulse.
        top ? "border-[3px]" : "border-2",
        focusRing,
      )}
      style={
        {
          left: placed.left,
          top: placed.top,
          "--c": level?.colour ?? "rgb(var(--muted))",
          ...stagger(index),
        } as CSSProperties
      }
    />
  );
}

function Legend({ scale }: { scale: readonly SeverityLevel[] }) {
  return (
    <GlassPanel
      variant="float"
      className="absolute bottom-3 left-3 z-[2] flex flex-wrap gap-3 px-2.5 py-1.5 text-xs"
    >
      {[...scale]
        .sort((a, b) => b.level - a.level)
        .map((l) => (
          <span
            key={l.level}
            className="inline-flex items-center gap-1.5"
            style={{ "--c": l.colour } as CSSProperties}
          >
            <span aria-hidden className="h-2 w-2 rounded-full bg-[color:var(--c)]" />
            {l.name}
          </span>
        ))}
    </GlassPanel>
  );
}

/**
 * F §9.1 map hero: the newest ready map as tiles, locked until clicked, with open-finding pins.
 * `hasData`: the project holds any data (from the Overview payload), so an empty hero says there is
 * nothing located to show rather than asking for data.
 */
export function MapHero({
  projectId,
  heroMapId,
  hasData,
  className,
}: {
  projectId: string;
  heroMapId: string | null;
  hasData: boolean;
  className?: string;
}) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const navigate = useNavigate();
  const scale = useSeverityScale();
  const revision = useChangesStore((s) => s.findingsRevision);
  const [readRevision, setReadRevision] = useState(revision);
  // `failed`: the last read failed. A failed refresh keeps the pins already on screen.
  const [pins, setPins] = useState<{ projectId: string; items: PinInput[]; failed: boolean } | null>(null);
  const [geo, setGeo] = useState<{ id: string; map: GeoMap | null } | null>(null);
  const [ol, setOl] = useState<OlMap | null>(null);
  // The whole view, a new object on every `moveend`: a resize keeps the resolution but moves the
  // extent, and the pins must follow it.
  const [view, setView] = useState<{ extent: number[]; resolution: number } | null>(null);

  // `findings.changed` arrives in bursts; settle for 400 ms before re-reading.
  useEffect(() => {
    if (revision === readRevision) return;
    const timer = window.setTimeout(() => setReadRevision(revision), REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [revision, readRevision]);

  useEffect(() => {
    let cancelled = false;
    listFindings(api, projectId, {
      has_location: true,
      status: ["open"],
      sort: "-severity",
      limit: HERO_PIN_LIMIT,
    })
      .then((page) => {
        if (!cancelled) setPins({ projectId, items: pinsFromFindings(page.items), failed: false });
      })
      .catch((e: unknown) => {
        pushLog(`hero pins unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled)
          setPins((prev) =>
            prev?.projectId === projectId
              ? { ...prev, failed: true }
              : { projectId, items: [], failed: true },
          );
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, readRevision]);

  useEffect(() => {
    if (!heroMapId) return;
    let cancelled = false;
    fetchMap(api, projectId, heroMapId)
      .then((map) => {
        if (!cancelled) setGeo({ id: heroMapId, map: map.status === "ready" ? map : null });
      })
      .catch((e: unknown) => {
        pushLog(`hero map unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setGeo({ id: heroMapId, map: null });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, heroMapId]);

  const items = pins?.projectId === projectId ? pins.items : null;
  const pinsFailed = pins?.projectId === projectId && pins.failed && pins.items.length === 0;
  const topLevelNo = topLevel(scale)?.level ?? null;
  const map = heroMapId && geo?.id === heroMapId ? geo.map : null;
  const mapPending = Boolean(heroMapId) && geo?.id !== heroMapId;

  const placedOnMap = useMemo<Placed[]>(() => {
    if (!map || !ol || !view || !items) return [];
    return items.flatMap((pin) => {
      const px = lonLatToMapPixel(map, pin.lon, pin.lat);
      const screen = px ? ol.getPixelFromCoordinate(toOl(px[0], px[1])) : null;
      return screen ? [{ pin, left: `${screen[0]}px`, top: `${screen[1]}px` }] : [];
    });
  }, [map, ol, view, items]);

  const backdrop = useMemo(() => (items && !map ? backdropLayout(items) : null), [items, map]);

  const frame = cx("relative h-full min-h-0 overflow-hidden", className);
  if (!items || mapPending)
    return (
      <GlassPanel variant="pane" className={frame}>
        <Skeleton className="absolute inset-0" />
      </GlassPanel>
    );

  if (!map && items.length === 0 && (hasData || pinsFailed))
    return (
      <GlassPanel variant="pane" className={cx(frame, "grid place-items-center")}>
        {pinsFailed ? (
          <EmptyState icon="map" title="The finding pins could not be loaded">
            They are read again when findings change. The rest of the Overview is unaffected.
          </EmptyState>
        ) : (
          <EmptyState icon="map" title="No open findings with a location">
            Open findings from geotagged photos, maps and point clouds appear here as pins.
          </EmptyState>
        )}
      </GlassPanel>
    );

  if (!map && items.length === 0)
    return (
      <GlassPanel variant="pane" className={cx(frame, "grid place-items-center")}>
        <EmptyState
          icon="map"
          title="Start by adding data"
          action={
            <AddDataButton projectId={projectId} variant="primary" icon="plus">
              Add data
            </AddDataButton>
          }
        >
          Photos, an orthomosaic, an elevation model or a point cloud. Each import runs in the background, and
          open findings appear here as pins.
        </EmptyState>
      </GlassPanel>
    );

  const placed: Placed[] = map
    ? placedOnMap
    : (backdrop?.points ?? []).map((p, i) => ({ pin: items[i], left: `${p.xPct}%`, top: `${p.yPct}%` }));
  const mapBar = map && view ? scaleBar(view.resolution, map.gsd_cm, 120) : null;
  const bar = map
    ? mapBar && { width: `${mapBar.px}px`, label: mapBar.label }
    : backdrop?.scale && { width: `${backdrop.scale.widthPct}%`, label: backdrop.scale.label };
  const mapsHref = heroMapId ? `/p/${projectId}/maps?map=${heroMapId}` : `/p/${projectId}/maps`;

  return (
    <GlassPanel variant="pane" as="section" className={frame} aria-label="Site map">
      {map ? (
        <div className="pointer-events-none absolute inset-0">
          <MapView
            geoMap={map}
            tileUrl={mapTileUrl(baseUrl, token, projectId, map.id)}
            onReady={setOl}
            onViewChange={(v) => setView({ extent: [...v.extent], resolution: v.resolution })}
          />
        </div>
      ) : (
        <div aria-hidden className="absolute inset-0 bg-surface-2" />
      )}
      <button
        type="button"
        aria-label="Open the Maps tab"
        onClick={() => void navigate(mapsHref)}
        className={cx("absolute inset-0 z-[1] cursor-pointer rounded-panel", focusRing)}
      />
      {/* Most severe first from the server: pop in that order, but paint them last so they sit on top. */}
      {placed
        .map((p, i) => (
          <Pin
            key={p.pin.id}
            projectId={projectId}
            placed={p}
            index={i}
            scale={scale}
            topLevelNo={topLevelNo}
          />
        ))
        .reverse()}
      <GlassPanel variant="float" className="absolute left-3 top-3 z-[2] px-2.5 py-1.5 text-xs">
        {map ? `${map.name}${map.captured_on ? ` · ${map.captured_on}` : ""}` : "Open findings by location"}
        {pinsFailed && " · pins could not be loaded"}
      </GlassPanel>
      <Legend scale={scale} />
      {bar && (
        <GlassPanel
          variant="float"
          className="absolute bottom-3 right-3 z-[2] px-2.5 py-1.5 font-mono text-2xs"
        >
          <span data-testid="hero-scale" className="flex items-center gap-2">
            <span
              aria-hidden
              className="block h-1 border-x border-b border-ink"
              style={{ width: bar.width }}
            />
            {bar.label}
          </span>
        </GlassPanel>
      )}
    </GlassPanel>
  );
}
