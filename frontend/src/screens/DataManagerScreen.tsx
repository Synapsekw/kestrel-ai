import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useProject, useSourceNames } from "@/api/project";
import { useProjectKind } from "@/app/useProjectKind";
import { useJobsStore } from "@/store/jobs";
import { EmptyImages } from "@/data/EmptyImages";
import { importNotice, type Notice } from "@/data/importNotice";
import { proposalsABulkMarkRejects } from "@/data/markEmptyCounts";
import { FilterBar } from "@/data/FilterBar";
import { ImageGrid } from "@/data/ImageGrid";
import { ImageTable } from "@/data/ImageTable";
import { ImportImagesDialog } from "@/data/ImportImagesDialog";
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
import { isTypingTarget } from "@/ui/keymap";
import { useNavigationStore } from "@/store/navigation";
import { Alert, Button, IconButton, Kbd, Skeleton, buttonClass, type AlertTone } from "@/ui";

const NOTICE_TONE: Record<Notice["tone"], AlertTone> = {
  info: "info",
  ok: "ok",
  warn: "warn",
  error: "danger",
};

/** Alternatives are separate keys ("J / K"); a combination is pressed together ("Ctrl + A"). */
const SHORTCUTS: { keys: string[][]; does: string }[] = [
  { keys: [["J"], ["K"]], does: "Next or previous image" },
  { keys: [["Enter"]], does: "Open the image (or double-click it)" },
  { keys: [["Space"]], does: "Select or deselect the image" },
  { keys: [["Ctrl", "A"]], does: "Select all listed images" },
  { keys: [["Esc"]], does: "Clear the selection" },
];

/** The keyboard icon button and its small legend; Escape or a click outside closes it. */
function ShortcutsButton() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div
      ref={wrapRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <IconButton
        ref={buttonRef}
        icon="keyboard"
        label="Keyboard shortcuts"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          className="absolute right-0 top-full z-20 mt-1.5 w-80 rounded-lg border border-line bg-glass-solid p-3 shadow-float animate-reveal reduce-motion:animate-none"
        >
          <p className="mb-2 text-xs font-medium text-muted">In the image grid and list</p>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13px]">
            {SHORTCUTS.map((s) => (
              <div key={s.does} className="contents">
                <dt className="flex items-center gap-1 text-xs text-muted">
                  {s.keys.map((combo, i) => (
                    <span key={combo.join("+")} className="flex items-center gap-1">
                      {i > 0 && <span aria-hidden="true">/</span>}
                      {combo.map((k, j) => (
                        <span key={k} className="flex items-center gap-1">
                          {j > 0 && <span aria-hidden="true">+</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  ))}
                </dt>
                <dd className="text-ink">{s.does}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

/** Placeholder tiles while the first page of images (or the project) loads. */
function GridSkeleton() {
  return (
    <div className="flex flex-wrap gap-3">
      <span className="sr-only">Loading images</span>
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-[206px] w-[220px] rounded-lg" />
      ))}
    </div>
  );
}

export function DataManagerScreen() {
  const { projectId = "" } = useParams();
  const kind = useProjectKind(projectId);
  const navigate = useNavigate();
  const { project } = useProject(projectId);
  const sourceNames = useSourceNames(projectId);
  // `?notice=all-labeled` (sent by the Label step when nothing is left to label) is read once and
  // then dropped from the URL, so a reload or a back navigation does not show it again.
  const [searchParams, setSearchParams] = useSearchParams();
  const [allLabeled, setAllLabeled] = useState(() => searchParams.get("notice") === "all-labeled");
  useEffect(() => {
    if (!searchParams.has("notice")) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("notice");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);
  const [query, setQuery] = useState<ListQuery>(DEFAULT_QUERY);
  const [view, setView] = useState<ViewMode>("grid");
  const params = useMemo(() => toImageParams(query, IMAGE_PAGE_SIZE), [query]);
  const list = useImageList(projectId, params);
  const items = useMemo(() => applyClientFilters(list.items, query.filters), [list.items, query.filters]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // The import this screen started; its banner follows the job in the store until dismissed.
  const [importRun, setImportRun] = useState<{ jobId: string; folder: string } | null>(null);
  const importJob = useJobsStore((s) => (importRun ? s.jobs[importRun.jobId] : undefined));
  const importBanner = importRun && importJob ? importNotice(importJob, importRun.folder) : null;
  const [rawFocus, setFocusIndex] = useState(0);
  // Derived, not synced with effects: the focus row is clamped to the list and the selection is
  // pruned to the ids currently listed (React Compiler rule `set-state-in-effect`).
  const focusIndex = Math.min(rawFocus, Math.max(0, ids.length - 1));
  const pruned = useMemo(() => pruneSelection(selection, ids), [selection, ids]);
  const rowContext = useMemo(() => ({ sourceNames }), [sourceNames]);

  const open = useCallback(
    (id: string) => {
      useNavigationStore.getState().setContext(ids, "data", `/p/${projectId}/data`);
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
  const selectedRows = useMemo(() => items.filter((i) => pruned.selected.has(i.id)), [items, pruned]);
  const selectedEmptyCount = useMemo(() => selectedRows.filter((i) => i.marked_empty).length, [selectedRows]);
  const selectedLabeledCount = useMemo(
    () => selectedRows.filter((i) => i.box_count > 0).length,
    [selectedRows],
  );
  const selectedUnlabeledCount = useMemo(() => selectedRows.filter((i) => !i.labeled).length, [selectedRows]);
  const selectedPendingCount = useMemo(() => proposalsABulkMarkRejects(selectedRows), [selectedRows]);
  const labelSelected = () => {
    useNavigationStore.getState().setContext(selectedIds, "selection");
    void navigate(`/p/${projectId}/edit/${selectedIds[0]}`);
  };

  const empty = !list.loading && !list.error && items.length === 0 && project !== null && !importing;
  const filtered = JSON.stringify(query.filters) !== JSON.stringify(DEFAULT_QUERY.filters);

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Images</h1>
        <div className="flex items-center gap-2">
          <ShortcutsButton />
          <Button variant="primary" icon="import" onClick={() => setImporting((v) => !v)} disabled={!project}>
            Import images
          </Button>
        </div>
      </div>
      {allLabeled && kind !== "detect" && (
        <Alert
          tone="ok"
          onDismiss={() => setAllLabeled(false)}
          actions={
            <Link to={`/p/${projectId}/datasets`} className={buttonClass("secondary", "sm")}>
              Open Datasets
            </Link>
          }
        >
          Every image is labeled. Create a dataset next.
        </Alert>
      )}
      {importing && project && (
        <ImportImagesDialog
          project={project}
          onClose={() => setImporting(false)}
          onStarted={(result) => {
            setImporting(false);
            setNotice(null);
            setImportRun({ jobId: result.job.id, folder: result.source.folder });
          }}
        />
      )}
      <FilterBar
        query={query}
        onChange={setQuery}
        view={view}
        onView={setView}
        sourceNames={sourceNames}
        total={list.total}
        onSelectAll={() => setSelection(selectAll(ids))}
        loaded={items.length}
      />
      {list.error && <Alert tone="danger">{list.error}</Alert>}
      {/* One slot of constant height: a bar that appears on the first click of a double-click would
          move the rows away from under the second click. */}
      <div className="flex min-h-[3.25rem] flex-col justify-center">
        {selectedIds.length > 0 ? (
          <SelectionBar
            projectId={projectId}
            selectedIds={selectedIds}
            labeledCount={selectedLabeledCount}
            emptyCount={selectedEmptyCount}
            unlabeledCount={selectedUnlabeledCount}
            pendingCount={selectedPendingCount}
            onLabel={labelSelected}
            kind={kind}
            onRunModel={() => {
              useNavigationStore.getState().setContext(selectedIds, "query");
              void navigate(`/p/${projectId}/query`);
            }}
            onDeleted={(message) => {
              setSelection(clearSelection());
              setNotice(message);
            }}
            onMarked={(message) => {
              setSelection(clearSelection());
              setNotice(message);
            }}
            onClear={() => setSelection(clearSelection())}
          />
        ) : notice ? (
          <Alert tone="ok" onDismiss={() => setNotice(null)}>
            {notice}
          </Alert>
        ) : (
          items.length > 0 && (
            <p className="text-[13px] text-muted">
              Select images (checkbox, Space or Ctrl+A) to label them in a row, run a model on them, add them
              to a dataset or delete them.
            </p>
          )
        )}
      </div>
      {importBanner && (
        <Alert
          testId="import-notice"
          tone={NOTICE_TONE[importBanner.tone]}
          onDismiss={importBanner.tone !== "info" ? () => setImportRun(null) : undefined}
        >
          {importBanner.text}
        </Alert>
      )}
      {empty ? (
        <EmptyImages
          filtered={filtered}
          onImport={() => setImporting(true)}
          onClearFilters={() => setQuery((q) => ({ ...q, filters: DEFAULT_QUERY.filters }))}
        />
      ) : items.length === 0 && !list.error && (list.loading || !project) ? (
        <GridSkeleton />
      ) : view === "list" ? (
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
      {list.loading && items.length > 0 && <Skeleton className="h-1.5 w-full shrink-0" />}
    </section>
  );
}
