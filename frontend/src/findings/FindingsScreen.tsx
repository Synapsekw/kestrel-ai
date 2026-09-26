import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Finding } from "@/api/findings";
import { useNow } from "@/jobs/useNow";
import { Alert, Button, DataTable, EmptyState, InspectorLayout, useSeverityScale } from "@/ui";
import { findingColumns } from "./columns";
import { FindingFiltersBar } from "./FindingFilters";
import { DEFAULT_FILTERS, filtersToSearch, isFiltered, parseFilters, type FindingFilters } from "./filters";
import { findingPath } from "./links";
import { useDataLabels } from "./useDataLabels";
import { useFindingsList } from "./useFindingsList";
import { useFindingSummary } from "./useFindingSummary";
import { useProjectTypes } from "./useProjectTypes";

/** The project's one Findings list (F §8.6): filters in the URL, a virtualised table, the inspector route. */
export function FindingsScreen() {
  const { projectId = "", findingId } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const filters = useMemo(() => parseFilters(search), [search]);
  const list = useFindingsList(projectId, filters);
  const summary = useFindingSummary(projectId);
  const scale = useSeverityScale();
  const { types, all } = useProjectTypes(projectId);
  const labels = useDataLabels(projectId);
  const nowMs = useNow(60_000);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const query = search.toString();
  const suffix = query ? `?${query}` : "";

  const onFilters = useCallback(
    (next: FindingFilters) => {
      setSelected(new Set());
      setSearch(filtersToSearch(next), { replace: true });
    },
    [setSearch],
  );
  const openFinding = useCallback(
    (f: Finding) => void navigate(`${findingPath(projectId, f.id)}${suffix}`),
    [navigate, projectId, suffix],
  );
  const columns = useMemo(
    () => findingColumns({ projectId, types, labels, nowMs }),
    [projectId, types, labels, nowMs],
  );
  const empty = list.status === "ready" && list.items.length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col gap-4" aria-label="Findings">
      <header>
        <h1 className="text-xl font-semibold">Findings</h1>
        <p className="text-sm text-muted">
          Every defect in this project, from photos, maps and point clouds. Grade, comment and close them
          here.
        </p>
      </header>
      <FindingFiltersBar filters={filters} summary={summary} scale={scale} types={all} onChange={onFilters} />
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
      <InspectorLayout inspector={null}>
        {empty ? (
          isFiltered(filters) ? (
            <EmptyState
              icon="findings"
              title="No findings match these filters"
              action={
                <Button onClick={() => onFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState icon="findings" title="No findings yet">
              Findings are made in the Images, Maps and Point clouds workspaces: mark a defect there, or
              accept an AI detection of a defect type.
            </EmptyState>
          )
        ) : (
          <DataTable
            label="Findings"
            className="h-full"
            columns={columns}
            rows={list.items}
            rowKey={(f) => f.id}
            loading={list.status === "loading"}
            selected={selected}
            onSelectionChange={setSelected}
            activeKey={findingId ?? null}
            onOpen={openFinding}
            onEndReached={list.hasMore ? list.loadMore : undefined}
          />
        )}
      </InspectorLayout>
    </section>
  );
}
