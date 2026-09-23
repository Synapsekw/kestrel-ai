import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { GeoMap } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { deleteSiteArea, listSiteAreas, updateSiteArea, type SiteArea } from "@/api/siteAreas";
import { DRAW_PARAM, DRAW_SITE_AREA } from "@/analytics/useSiteAreaOverlay";
import { Alert, Button, EmptyState, Field, Input, Select, SkeletonRows } from "@/ui";

function AreaRow({
  area,
  onRename,
  onDelete,
}: {
  area: SiteArea;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [name, setName] = useState(area.name);
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<void>) => {
    setBusy(true);
    work()
      .then(() => setMode("view"))
      .catch(() => undefined) // the screen shows the error; the row stays open to try again
      .finally(() => setBusy(false));
  };

  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0">
      {mode === "rename" ? (
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) run(() => onRename(name.trim()));
          }}
        >
          <Input
            dense
            autoFocus
            aria-label="New name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            className="w-64"
          />
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!name.trim()}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode("view")}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{area.name}</p>
          <p className="text-xs text-muted">
            {area.polygon_wgs84.length} corners, added {area.created_at.slice(0, 10)}
          </p>
        </div>
      )}
      {mode === "view" && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setMode("rename")}>
            Rename
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => setMode("delete")}>
            Delete
          </Button>
        </div>
      )}
      {mode === "delete" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Its counts go with it.</span>
          <Button size="sm" variant="danger" loading={busy} onClick={() => run(onDelete)}>
            Delete site area
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
            Keep
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Site areas: named parts of the site, outlined once on any map and counted on every map that
 * covers them. Changing one recounts the maps in the background.
 */
export function SiteAreasScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const [areas, setAreas] = useState<SiteArea[] | null>(null);
  const [maps, setMaps] = useState<GeoMap[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapPick, setMapPick] = useState<string | null>(null);

  const load = useCallback(() => {
    listSiteAreas(api, projectId)
      .then((a) => {
        setAreas(a);
        setError(null);
      })
      .catch((e: unknown) => setError(messageOf(e, "Could not load the site areas.")));
    listMaps(api, projectId)
      .then(setMaps)
      .catch(() => setMaps([]));
  }, [api, projectId]);
  useEffect(load, [load]);

  // Only a ready map with a georeference can place an outline on the ground.
  const drawable = useMemo(
    () => (maps ?? []).filter((m) => m.status === "ready" && m.geotransform && m.proj4),
    [maps],
  );
  const mapId = drawable.find((m) => m.id === mapPick)?.id ?? drawable[0]?.id ?? "";

  const rename = (area: SiteArea) => async (name: string) => {
    try {
      const updated = await updateSiteArea(api, projectId, area.id, { name });
      setAreas((as) => as?.map((a) => (a.id === area.id ? updated : a)) ?? null);
    } catch (e) {
      setError(messageOf(e, "Could not rename the site area."));
      throw e;
    }
  };
  const remove = (area: SiteArea) => async () => {
    try {
      await deleteSiteArea(api, projectId, area.id);
      setAreas((as) => as?.filter((a) => a.id !== area.id) ?? null);
    } catch (e) {
      setError(messageOf(e, "Could not delete the site area."));
      throw e;
    }
  };

  const drawer =
    drawable.length > 0 ? (
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Map" htmlFor="site-area-map">
          <Select
            id="site-area-map"
            wrapperClassName="w-60"
            value={mapId}
            onChange={(e) => setMapPick(e.target.value)}
          >
            {drawable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="primary"
          icon="plus"
          onClick={() => navigate(`/p/${projectId}/maps/${mapId}?${DRAW_PARAM}=${DRAW_SITE_AREA}`)}
        >
          Draw an area
        </Button>
      </div>
    ) : maps ? (
      <p className="text-sm text-muted">Add a map of the site first: an area is outlined on a map.</p>
    ) : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Site areas</h1>
      <p className="mt-1 max-w-prose text-sm text-muted">
        Outline a part of the site once, such as a laydown yard, and Analytics counts the objects inside it on
        every map that covers it.
      </p>
      <div className="mt-6">{drawer}</div>
      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      <div className="mt-8">
        {!areas && !error && <SkeletonRows rows={3} columns={2} />}
        {areas && areas.length === 0 && (
          <EmptyState icon="map" title="No site areas yet">
            Pick a map above and draw around the part of the site you want counted.
          </EmptyState>
        )}
        {areas && areas.length > 0 && (
          <ul aria-label="Site areas">
            {areas.map((a) => (
              <AreaRow key={a.id} area={a} onRename={rename(a)} onDelete={remove(a)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
