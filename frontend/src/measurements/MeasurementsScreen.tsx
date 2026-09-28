import { useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { MeasurementItem } from "@/api/measurements";
import { useNow } from "@/jobs/useNow";
import { Alert, Button, DataTable, EmptyState } from "@/ui";
import { measurementColumns } from "./columns";
import { measurementHref, volumeViewPath } from "./links";
import { MeasurementFiltersBar } from "./MeasurementFilters";
import { DEFAULT_FILTERS, filtersToSearch, isFiltered, parseFilters, type MeasurementFilters } from "./model";
import { rowKeyOf, useMeasurementsList } from "./useMeasurementsList";

/**
 * The project's Measurements tab (R8): M's `GET /measurements` union in one paged table. A row opens
 * where it was measured: the map workspace, the cloud workspace, or the volume view.
 */
export function MeasurementsScreen() {
  const { projectId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const filters = useMemo(() => parseFilters(search), [search]);
  const list = useMeasurementsList(projectId, filters);
  const nowMs = useNow(60_000);
  const columns = useMemo(() => measurementColumns(nowMs), [nowMs]);

  const onFilters = useCallback(
    (next: MeasurementFilters) => setSearch(filtersToSearch(next), { replace: true }),
    [setSearch],
  );
  const open = useCallback(
    (m: MeasurementItem) => {
      const href = measurementHref(projectId, m);
      if (href) void navigate(href);
    },
    [navigate, projectId],
  );

  const empty = list.status === "ready" && list.items.length === 0;
  // A failed first load shows only the Alert, not an empty table under it.
  const failed = list.status === "error" && list.items.length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col gap-4" aria-label="Measurements">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Measurements</h1>
          <p className="text-sm text-muted">
            Every distance, area, profile, point-cloud measurement and volume in this project. Open one to see
            it where it was measured.
          </p>
        </div>
        <Button icon="volume" onClick={() => void navigate(volumeViewPath(projectId))}>
          Surfaces and volumes
        </Button>
      </header>
      <MeasurementFiltersBar filters={filters} onChange={onFilters} />
      {list.status === "error" && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={list.reload}>
              Retry
            </Button>
          }
        >
          {list.error}
        </Alert>
      )}
      {failed ? null : empty ? (
        isFiltered(filters) ? (
          <EmptyState
            icon="measure"
            title="No measurements match these filters"
            action={<Button onClick={() => onFilters(DEFAULT_FILTERS)}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            icon="measure"
            title="No measurements yet"
            action={<Button onClick={() => void navigate(`/p/${projectId}/maps`)}>Open maps</Button>}
          >
            Measure a distance, an area or a profile in Maps, a point or a height in Point clouds, or a
            stockpile in Surfaces and volumes.
          </EmptyState>
        )
      ) : (
        <DataTable
          label="Measurements"
          className="min-h-0 flex-1"
          columns={columns}
          rows={list.items}
          rowKey={rowKeyOf}
          loading={list.status === "loading"}
          onOpen={open}
          onEndReached={list.hasMore ? list.loadMore : undefined}
        />
      )}
    </section>
  );
}
