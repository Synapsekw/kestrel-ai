import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { fetchAreaAnalytics, type AreaAnalytics } from "@/api/analytics";
import { messageOf } from "@/api/errors";
import { listSiteAreasInFrame, updateSiteArea, type SiteAreaPatch } from "@/api/siteAreas";
import { Alert, Button, InspectorSection, Pill, Select, Skeleton, SkeletonRows, toast } from "@/ui";
import type { InspectorBodyProps } from "@/mapws/annotations/bindings";
import { formatArea, formatDate } from "@/mapws/annotations/format";
import { FramedBody } from "@/mapws/annotations/FramedBody";
import { NameField } from "@/mapws/annotations/NameField";
import { ringArea } from "@/mapws/annotations/planar";
import { removeZone, zoneDeleted } from "./actions";
import { CATEGORY_LABEL, ZONE_CATEGORIES, categoryOf, surveyCounts, type ZoneCategory } from "./categories";
import { useZonesStore } from "./store";

/** Spec §5.3 "Zone": name, category, area, and objects per survey from `/analytics/areas`. */
export function ZoneInspector({ selection, projectId, frame, onClose }: InspectorBodyProps) {
  const id = selection.id;
  const api = useApi();
  const area = useZonesStore((s) => s.items.find((a) => a.id === id) ?? null);
  const missing = area === null;
  const [analytics, setAnalytics] = useState<{ id: string; data: AreaAnalytics | null } | null>(null);
  // M-W3 P12: the id this inspector has read the zones for itself (row hidden, deep link).
  const [lookedUp, setLookedUp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const local = frame.kind === "local";

  useEffect(() => {
    let live = true;
    fetchAreaAnalytics(api, projectId)
      .then((data) => {
        if (live) setAnalytics({ id, data });
      })
      .catch(() => {
        if (live) setAnalytics({ id, data: null });
      });
    return () => {
      live = false;
    };
  }, [api, projectId, id]);

  // M-W3 P12: one bounded `GET /site-areas?frame=site` when the zone is not in the layer's store.
  useEffect(() => {
    if (!missing || local || lookedUp === id) return;
    let live = true;
    listSiteAreasInFrame(api, projectId)
      .then((areas) => {
        if (!live) return;
        if (!useZonesStore.getState().items.some((a) => a.id === id)) useZonesStore.getState().set(areas);
        setLookedUp(id);
      })
      .catch(() => {
        if (live) setLookedUp(id);
      });
    return () => {
      live = false;
    };
  }, [api, projectId, id, missing, local, lookedUp]);

  const header = <span className="text-xs text-muted">Selected zone</span>;
  if (!area) {
    if (!local && lookedUp !== id)
      return (
        <FramedBody header={<Skeleton className="h-4 w-28" />}>
          <SkeletonRows rows={4} columns={1} />
        </FramedBody>
      );
    return (
      <FramedBody header={header}>
        <Alert tone="info">This zone is not loaded. It may have been deleted.</Alert>
      </FramedBody>
    );
  }

  const category = categoryOf(area);
  const rows = analytics?.id === id ? surveyCounts(analytics.data, id) : null;

  async function patch(body: SiteAreaPatch) {
    setBusy(true);
    try {
      useZonesStore.getState().upsert(await updateSiteArea(api, projectId, id, body));
    } catch (e) {
      toast("danger", messageOf(e, "could not save the zone"));
    } finally {
      setBusy(false);
    }
  }

  // W3-14: the inspector's Delete deletes at once; only W1's `Del` asks first (remove.confirm).
  async function remove(name: string) {
    try {
      await removeZone(api, projectId, id);
      toast("ok", zoneDeleted(name));
      onClose();
    } catch (e) {
      toast("danger", messageOf(e, "could not delete the zone"));
    }
  }

  return (
    <FramedBody
      header={
        <div className="flex min-w-0 items-center gap-2">
          {header}
          <Pill size="sm" tone={category === "exclusion" ? "warn" : "accent"}>
            {CATEGORY_LABEL[category]}
          </Pill>
        </div>
      }
      footer={
        <Button
          variant="danger"
          size="sm"
          icon="trash"
          className="w-full justify-center"
          onClick={() => void remove(area.name)}
        >
          Delete
        </Button>
      }
    >
      <InspectorSection title="Name">
        <NameField
          key={`${area.id}:${area.name}`}
          initial={area.name}
          onSave={(name) => void patch({ name })}
        />
      </InspectorSection>
      <InspectorSection title="Category">
        <Select
          aria-label="Category"
          value={category}
          disabled={busy}
          onChange={(e) => void patch({ category: e.target.value as ZoneCategory })}
        >
          {ZONE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
      </InspectorSection>
      <InspectorSection title="Area">
        <p className="flex items-baseline gap-2">
          <span className="font-mono text-sm tabular-nums text-ink">
            {area.polygon_site ? `≈ ${formatArea(ringArea(area.polygon_site))}` : "–"}
          </span>
          <span className="text-2xs text-muted">grid</span>
        </p>
      </InspectorSection>
      <InspectorSection title="Objects per survey">
        {rows === null ? (
          <SkeletonRows rows={2} columns={1} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">No survey covers this zone yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((r) => (
              <li key={r.key} className="flex items-baseline justify-between gap-2">
                <span className="text-ink">{formatDate(r.date)}</span>
                <span className="font-mono tabular-nums text-muted">{`${r.total} objects${r.partial ? " · partial" : ""}`}</span>
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>
    </FramedBody>
  );
}
