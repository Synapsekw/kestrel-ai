import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type OlMap from "ol/Map";
import { mapTileUrl, type GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { listMaps } from "@/api/maps";
import { useProject } from "@/api/project";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { ImportMapDialog } from "@/maps/ImportMapDialog";
import { MapList } from "@/maps/MapList";
import { MapOverlay } from "@/maps/MapOverlay";
import { MapView } from "@/maps/MapView";
import { makeReadout, type Readout } from "@/maps/coords";
import { Alert, Button, EmptyState } from "@/ui";

const nf = new Intl.NumberFormat("en-GB").format;
const px = (n: number) => nf(n).replace(/,/g, " ");

function MapFacts({ m }: { m: GeoMap }) {
  const rows: [string, string][] = [
    ["Size", `${px(m.width)} × ${px(m.height)} px`],
    ["Ground resolution", m.gsd_cm ? `${m.gsd_cm.toFixed(1)} cm / px` : "unknown"],
    ["Coordinate system", m.epsg ? `EPSG:${m.epsg}` : m.crs_wkt ? "custom (see export)" : "none"],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right tabular-nums text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MapsScreen() {
  const { projectId = "", mapId } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const { baseUrl, token } = useBackend();
  useProject(projectId);
  const [maps, setMaps] = useState<GeoMap[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [olMap, setOlMap] = useState<OlMap | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [resolution, setResolution] = useState(1);

  const reload = useCallback(() => {
    void listMaps(api, projectId).then(setMaps);
  }, [api, projectId]);
  useEffect(reload, [reload]);
  useOnJobsFinished("map_import", reload);

  const active = maps?.find((m) => m.id === mapId) ?? null;
  const read = useMemo(() => (active ? makeReadout(active) : null), [active]);
  const tileUrl = active ? mapTileUrl(baseUrl, token, projectId, active.id) : "";

  if (maps && maps.length === 0 && !importing) {
    return (
      <EmptyState
        icon="map"
        title="Import a GeoTIFF map"
        action={
          <Button variant="primary" icon="import" onClick={() => setImporting(true)}>
            Import map
          </Button>
        }
      >
        Bring in an orthomosaic, run your models across the whole site and count every machine on it.
      </EmptyState>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Maps</h1>
          <Button size="sm" icon="import" onClick={() => setImporting(true)}>
            Import map
          </Button>
        </div>
        {maps && <MapList projectId={projectId} maps={maps} activeId={mapId} />}
      </section>
      <section className="relative min-w-0 flex-1">
        {active?.status === "ready" ? (
          <>
            <MapView
              geoMap={active}
              tileUrl={tileUrl}
              onReady={setOlMap}
              onPointer={(x, y) => setReadout(read ? read(x, y) : null)}
              onViewChange={(v) => setResolution(v.resolution)}
            />
            <MapOverlay map={olMap} geoMap={active} readout={readout} resolution={resolution} />
          </>
        ) : (
          <EmptyState icon="map" title={active ? `${active.name} is ${active.status}` : "Choose a map"}>
            {active?.error ?? "Pick a map on the left, or import one."}
          </EmptyState>
        )}
      </section>
      <aside
        data-testid="map-panel"
        className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line p-4"
      >
        {active && (
          <>
            <h2 className="truncate text-base font-semibold">{active.name}</h2>
            <MapFacts m={active} />
            {!active.crs_wkt && (
              <Alert tone="warn">
                No coordinates in this file: you can view, detect, label and score, and export boxes in
                pixels, but not as GIS layers.
              </Alert>
            )}
          </>
        )}
      </aside>
      {importing && (
        <ImportMapDialog
          projectId={projectId}
          onClose={() => setImporting(false)}
          onStarted={(m) => {
            setImporting(false);
            reload();
            navigate(`/p/${projectId}/maps/${m.id}`);
          }}
        />
      )}
    </div>
  );
}
