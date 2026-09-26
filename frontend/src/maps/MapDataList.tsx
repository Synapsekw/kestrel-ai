import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { updateMapDate } from "@/api/sources";
import { pushLog } from "@/app/diagnostics";
import { ADD_DATA_LOADING, openAddData, useAddDataReady } from "@/data/addDataTiles";
import { SurveyDateCell } from "@/sources/SurveyDateCell";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, EmptyState, Pill, SkeletonRows, Tooltip, type PillTone } from "@/ui";
import { detailOf, fetchMapItems, type DataItem } from "./dataItems";

const TYPE_LABEL: Record<string, string> = { map: "Orthomosaic", elevation: "Elevation", drawing: "Drawing" };
const STATUS: Record<string, { label: string; tone: PillTone; live?: boolean }> = {
  ready: { label: "Ready", tone: "ok" },
  importing: { label: "Importing", tone: "accent", live: true },
  failed: { label: "Failed", tone: "danger" },
};

/**
 * The Maps tab until the map workspace lands: the project's orthomosaics, elevation models and
 * drawings from the Data list, newest survey first, in pages of 100. A map opens in today's viewer.
 */
export function MapDataList() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const revision = useChangesStore((s) => s.dataRevision);
  const addReady = useAddDataReady(projectId);
  const [list, setList] = useState<{
    key: string;
    projectId: string;
    items: DataItem[];
    next: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const key = `${projectId}|${revision}`;

  useEffect(() => {
    let cancelled = false;
    fetchMapItems(api, projectId, null)
      .then((page) => {
        if (cancelled) return;
        setList({ key, projectId, items: page.items, next: page.next_cursor });
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load maps failed: ${messageOf(e, String(e))}`);
        setError(messageOf(e, "could not load the maps"));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  // Another project's list is never shown; after a data change the old list stays up until the new one lands.
  const current = list?.projectId === projectId ? list : null;

  const loadMore = useCallback(async () => {
    if (!current?.next) return;
    setMore(true);
    try {
      const page = await fetchMapItems(api, projectId, current.next);
      // A page that arrives after a switch or a reload belongs to a list that is gone.
      setList((l) =>
        l && l.key === current.key ? { ...l, items: [...l.items, ...page.items], next: page.next_cursor } : l,
      );
    } catch (e) {
      setError(messageOf(e, "could not load more maps"));
    } finally {
      setMore(false);
    }
  }, [api, projectId, current]);

  const saveDate = async (item: DataItem, next: string | null) => {
    await updateMapDate(api, projectId, item.id, next);
    setList((l) =>
      l ? { ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, captured_on: next } : i)) } : l,
    );
  };

  const items = current?.items ?? null;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Maps</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      {items === null && !error && <SkeletonRows rows={3} columns={5} />}
      {items && items.length === 0 && (
        <EmptyState
          icon="map"
          title="No maps yet"
          action={
            addReady ? (
              <Button variant="primary" icon="plus" onClick={() => openAddData("orthomosaic")}>
                Add an orthomosaic
              </Button>
            ) : (
              <Tooltip label={ADD_DATA_LOADING}>
                <Button variant="primary" icon="plus" disabled>
                  Add an orthomosaic
                </Button>
              </Tooltip>
            )
          }
        >
          Add a GeoTIFF orthomosaic of the site. Elevation models and drawings are listed here too.
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-2 font-medium">
                Name
              </th>
              <th scope="col" className="font-medium">
                Type
              </th>
              <th scope="col" className="font-medium">
                Survey date
              </th>
              <th scope="col" className="font-medium">
                State
              </th>
              <th scope="col" className="font-medium">
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const status = STATUS[item.status] ?? { label: item.status, tone: "neutral" as PillTone };
              const href =
                item.type === "map"
                  ? `/p/${projectId}/maps/${item.id}`
                  : item.type === "elevation"
                    ? `/p/${projectId}/measurements`
                    : null;
              return (
                <tr key={item.id} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">
                    {href ? (
                      <Link to={href} className="hover:underline">
                        {item.label}
                      </Link>
                    ) : (
                      item.label
                    )}
                  </th>
                  <td className="pr-3 text-muted">{TYPE_LABEL[item.type] ?? item.type}</td>
                  <td className="pr-3">
                    {item.type === "map" ? (
                      <SurveyDateCell
                        label={item.label}
                        value={item.captured_on}
                        onSave={(d) => saveDate(item, d)}
                      />
                    ) : (
                      <span className="text-muted">{item.captured_on ?? "date not set"}</span>
                    )}
                  </td>
                  <td className="pr-3">
                    <Pill size="sm" tone={status.tone} live={status.live}>
                      {status.label}
                    </Pill>
                  </td>
                  <td className="font-mono text-xs text-muted">{detailOf(item)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {current?.next && (
        <Button className="self-start" onClick={() => void loadMore()} loading={more}>
          Load more
        </Button>
      )}
    </section>
  );
}
