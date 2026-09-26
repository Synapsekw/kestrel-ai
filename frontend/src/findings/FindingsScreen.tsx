import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import type { BulkSet, Finding } from "@/api/findings";
import { useNow } from "@/jobs/useNow";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, DataTable, EmptyState, InspectorLayout, toast, useSeverityScale } from "@/ui";
import { applyBulk, bulkMessage } from "./bulk";
import { BulkBar } from "./BulkBar";
import { findingColumns } from "./columns";
import { FindingInspector } from "./FindingInspector";
import { FindingFiltersBar } from "./FindingFilters";
import { DEFAULT_FILTERS, filtersToSearch, isFiltered, parseFilters, type FindingFilters } from "./filters";
import { useInspectorCommands } from "./inspectorStore";
import { findingPath, findingsTabPath } from "./links";
import { STATUS_LABEL } from "./status";
import { useDataLabels } from "./useDataLabels";
import { useFindingKeys } from "./useFindingKeys";
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
  const closeInspector = useCallback(
    () => void navigate(findingsTabPath(projectId, query)),
    [navigate, projectId, query],
  );
  const onInspectorNavigate = useCallback(
    // null: the finding was deleted, so close before a re-read can show its 404.
    (href: string | null) => (href ? void navigate(href) : closeInspector()),
    [navigate, closeInspector],
  );

  // Review keys act on the checked rows, else on the finding open in the inspector (ambiguity 4);
  // both go through /findings/bulk so a skip (closed → reviewed) is reported the same way.
  const api = useApi();
  const applyKey = useCallback(
    async (set: BulkSet, what: string) => {
      const targets = selected.size > 0 ? [...selected] : findingId ? [findingId] : [];
      if (targets.length === 0) return;
      try {
        const r = await applyBulk(api, projectId, targets, set);
        useChangesStore.getState().bumpFindings();
        if (r.skipped.length || targets.length > 1)
          toast(r.skipped.length ? "info" : "ok", bulkMessage(r.updated, r.skipped, what));
      } catch (e) {
        toast("danger", messageOf(e, "could not update the finding"));
      }
    },
    [api, projectId, selected, findingId],
  );
  useFindingKeys(true, scale.length, {
    onSeverity: (level) =>
      void applyKey({ severity: level }, scale.find((l) => l.level === level)?.name ?? `Level ${level}`),
    onStatus: (status) => void applyKey({ status }, STATUS_LABEL[status]),
    onTypePicker: () => {
      if (findingId) useInspectorCommands.getState().openTypePicker();
    },
    onMove: (delta) => {
      const items = list.items;
      if (items.length === 0) return;
      const at = findingId ? items.findIndex((f) => f.id === findingId) : -1;
      const next = at === -1 ? 0 : at + delta;
      if (next >= 0 && next < items.length && next !== at) openFinding(items[next]);
    },
    onClose: () => {
      if (findingId) closeInspector();
      else if (selected.size > 0) setSelected(new Set());
      else return false;
      return true;
    },
  });

  const columns = useMemo(
    () => findingColumns({ projectId, types, labels, nowMs }),
    [projectId, types, labels, nowMs],
  );
  const empty = list.status === "ready" && list.items.length === 0;
  // A failed first load shows only the Alert, not an empty table under it.
  const failed = list.status === "error" && list.items.length === 0;
  const clearSelection = useCallback(() => setSelected(new Set()), []);

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
      <InspectorLayout
        inspector={
          findingId ? (
            <FindingInspector
              key={findingId}
              projectId={projectId}
              findingId={findingId}
              onNavigate={onInspectorNavigate}
            />
          ) : null
        }
      >
        {failed ? null : empty ? (
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
          <div className="relative h-full">
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
            {selected.size > 0 && (
              <BulkBar
                projectId={projectId}
                ids={[...selected]}
                scale={scale}
                onDone={clearSelection}
                onClear={clearSelection}
              />
            )}
          </div>
        )}
      </InspectorLayout>
    </section>
  );
}
