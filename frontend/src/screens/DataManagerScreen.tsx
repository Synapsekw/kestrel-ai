import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject, useSourceNames } from "@/api/project";
import { FilterBar } from "@/data/FilterBar";
import { ImageGrid } from "@/data/ImageGrid";
import { ImageTable } from "@/data/ImageTable";
import { SelectionBar } from "@/data/SelectionBar";
import {
  applyClientFilters,
  DATA_COLUMNS,
  DEFAULT_QUERY,
  keyboardAction,
  toggleSort,
  toImageParams,
  type ListQuery,
  type ViewMode,
} from "@/data/listModel";
import {
  clearSelection,
  clickSelect,
  EMPTY_SELECTION,
  pruneSelection,
  selectAll,
  toggleSelect,
} from "@/data/selection";
import { useImageList } from "@/data/useImageList";
import { IMAGE_PAGE_SIZE } from "@/api/images";
import { isTypingTarget } from "@/editor/hotkeys";
import { useNavigationStore } from "@/store/navigation";

export function DataManagerScreen() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const { project } = useProject(projectId);
  const sourceNames = useSourceNames(projectId);
  const [query, setQuery] = useState<ListQuery>(DEFAULT_QUERY);
  const [view, setView] = useState<ViewMode>("grid");
  const params = useMemo(() => toImageParams(query, IMAGE_PAGE_SIZE), [query]);
  const list = useImageList(projectId, params);
  const items = useMemo(() => applyClientFilters(list.items, query.filters), [list.items, query.filters]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [notice, setNotice] = useState<string | null>(null);
  const [rawFocus, setFocusIndex] = useState(0);
  // Derived, not synced with effects: the focus row is clamped to the list and the selection is
  // pruned to the ids currently listed (React Compiler rule `set-state-in-effect`).
  const focusIndex = Math.min(rawFocus, Math.max(0, ids.length - 1));
  const pruned = useMemo(() => pruneSelection(selection, ids), [selection, ids]);
  const rowContext = useMemo(() => ({ sourceNames }), [sourceNames]);

  const open = useCallback(
    (id: string) => {
      useNavigationStore.getState().setContext(ids, "data");
      void navigate(`/p/${projectId}/edit/${id}`);
    },
    [ids, navigate, projectId],
  );

  const onRowClick = useCallback(
    (id: string, index: number, mod: { shift: boolean; ctrl: boolean }) => {
      setFocusIndex(index);
      setSelection((s) => clickSelect(s, ids, id, mod));
    },
    [ids],
  );
  const onToggle = useCallback((id: string) => setSelection((s) => toggleSelect(s, id)), []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target)) return;
    const action = keyboardAction(e);
    if (!action) return;
    e.preventDefault();
    switch (action.type) {
      case "move":
        setFocusIndex((i) => Math.max(0, Math.min(ids.length - 1, i + action.delta)));
        break;
      case "open":
        if (ids[focusIndex]) open(ids[focusIndex]);
        break;
      case "toggle":
        if (ids[focusIndex]) onToggle(ids[focusIndex]);
        break;
      case "select-all":
        setSelection(selectAll(ids));
        break;
      case "clear":
        setSelection(clearSelection());
        break;
    }
  };

  const selectedIds = useMemo(() => ids.filter((id) => pruned.selected.has(id)), [ids, pruned]);
  const labelSelected = () => {
    useNavigationStore.getState().setContext(selectedIds, "selection");
    void navigate(`/p/${projectId}/edit/${selectedIds[0]}`);
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Data Manager</h1>
        <span className="text-xs text-slate-400">J / K move, Enter opens, Space selects</span>
      </div>
      <FilterBar
        query={query}
        onChange={setQuery}
        view={view}
        onView={setView}
        sourceNames={sourceNames}
        total={list.total}
        loaded={items.length}
      />
      {list.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {list.error}
        </p>
      )}
      {selectedIds.length > 0 && (
        <SelectionBar
          projectId={projectId}
          selectedIds={selectedIds}
          preannotationModelId={project?.preannotation_model_id ?? null}
          onLabel={labelSelected}
          onDeleted={(message) => {
            setSelection(clearSelection());
            setNotice(message);
          }}
          onClear={() => setSelection(clearSelection())}
        />
      )}
      {notice && selectedIds.length === 0 && (
        <p role="status" className="text-xs text-emerald-300">
          {notice}
        </p>
      )}
      {view === "list" ? (
        <ImageTable
          items={items}
          columns={DATA_COLUMNS}
          rowContext={rowContext}
          sort={{ key: query.sort, order: query.order }}
          onSort={(key) => setQuery((q) => toggleSort(q, key))}
          selected={pruned.selected}
          focusIndex={focusIndex}
          onRowClick={onRowClick}
          onOpen={open}
          onToggle={onToggle}
          onNearEnd={list.hasMore ? list.loadMore : undefined}
          onKeyDown={onKeyDown}
        />
      ) : (
        <ImageGrid
          projectId={projectId}
          items={items}
          selected={pruned.selected}
          focusIndex={focusIndex}
          onCellClick={onRowClick}
          onOpen={open}
          onToggle={onToggle}
          onNearEnd={list.hasMore ? list.loadMore : undefined}
          onKeyDown={onKeyDown}
        />
      )}
      {list.loading && <p className="text-xs text-slate-400">Loading…</p>}
      {!list.loading && items.length === 0 && !list.error && (
        <p className="text-sm text-slate-400">
          {project
            ? "No images match. Import a folder from the Projects screen or clear the filters."
            : "Loading project…"}
        </p>
      )}
    </section>
  );
}
