import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { REVIEW_QUEUE_QUERY } from "@/api/images";
import { useSourceNames } from "@/api/project";
import { ImageTable } from "@/data/ImageTable";
import { keyboardAction, REVIEW_COLUMNS } from "@/data/listModel";
import {
  clearSelection,
  clickSelect,
  EMPTY_SELECTION,
  pruneSelection,
  selectAll,
  toggleSelect,
} from "@/data/selection";
import { useImageList } from "@/data/useImageList";
import { isTypingTarget } from "@/editor/hotkeys";
import { useNavigationStore } from "@/store/navigation";
import { Alert, EmptyState, SkeletonRows } from "@/ui";

const linkClass = "font-medium text-accent hover:underline";

/** Spec section 6 screen 4: images with unreviewed suggestions sorted by suggestion confidence, same editor. */
export function ReviewScreen() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const sourceNames = useSourceNames(projectId);
  const [params] = useSearchParams();
  const location = useLocation();
  // `?ids=` narrows the queue to one query run's images (contract gap 2: `ids` overrides the filters).
  const runIds = params.get("ids");
  const query = useMemo(
    () => (runIds ? { ...REVIEW_QUEUE_QUERY, ids: runIds } : REVIEW_QUEUE_QUERY),
    [runIds],
  );
  const list = useImageList(projectId, query);
  const ids = useMemo(() => list.items.map((i) => i.id), [list.items]);
  const rowContext = useMemo(() => ({ sourceNames }), [sourceNames]);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [rawFocus, setFocusIndex] = useState(0);
  const focusIndex = Math.min(rawFocus, Math.max(0, ids.length - 1));
  const pruned = useMemo(() => pruneSelection(selection, ids), [selection, ids]);
  const firstLoad = list.loading && list.items.length === 0;
  const empty = !list.loading && !list.error && list.items.length === 0;

  const open = useCallback(
    (id: string) => {
      useNavigationStore.getState().setContext(ids, "review", location.pathname + location.search);
      void navigate(`/p/${projectId}/edit/${id}`);
    },
    [ids, navigate, projectId, location.pathname, location.search],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target)) return;
    const action = keyboardAction(e);
    if (!action) return;
    e.preventDefault();
    if (action.type === "move") setFocusIndex((i) => Math.max(0, Math.min(ids.length - 1, i + action.delta)));
    else if (action.type === "open" && ids[focusIndex]) open(ids[focusIndex]);
    else if (action.type === "toggle" && ids[focusIndex])
      setSelection((s) => toggleSelect(s, ids[focusIndex]));
    else if (action.type === "select-all") setSelection(selectAll(ids));
    else if (action.type === "clear") setSelection(clearSelection());
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Review</h1>
        <p className="text-sm text-muted">
          Suggestions from detection runs and pre-annotation wait here until you accept or reject them.
        </p>
        {runIds && (
          <p
            data-testid="run-filter"
            className="mt-1 text-sm text-ink animate-reveal motion-reduce:animate-none"
          >
            {list.loading
              ? "Loading the images of this detection run…"
              : `${list.total} of the ${runIds.split(",").length} images of this detection run still have suggestions to review.`}{" "}
            <Link to={`/p/${projectId}/review`} className={linkClass}>
              Show the whole queue
            </Link>
          </p>
        )}
      </div>

      {list.error && <Alert tone="danger">{list.error}</Alert>}

      {empty && (
        <div data-testid="review-empty" className="animate-reveal motion-reduce:animate-none">
          <EmptyState icon="review" title="Nothing to review">
            Suggestions appear here after a detection run on the{" "}
            <Link to={`/p/${projectId}/query`} className={linkClass}>
              Detect screen
            </Link>
            , or when the editor opens an image while a pre-annotation model is set in the{" "}
            <Link to={`/p/${projectId}/settings`} className={linkClass}>
              Project settings
            </Link>
            .
          </EmptyState>
        </div>
      )}

      {firstLoad ? (
        <SkeletonRows rows={8} columns={5} />
      ) : (
        !empty && (
          <ImageTable
            items={list.items}
            columns={REVIEW_COLUMNS}
            rowContext={rowContext}
            sort={{ key: "max_pending_confidence", order: "desc" }}
            selected={pruned.selected}
            focusIndex={focusIndex}
            onRowClick={(id, index, mod) => {
              setFocusIndex(index);
              setSelection((s) => clickSelect(s, ids, id, mod));
            }}
            onOpen={open}
            onToggle={(id) => setSelection((s) => toggleSelect(s, id))}
            onNearEnd={list.hasMore ? list.loadMore : undefined}
            onKeyDown={onKeyDown}
          />
        )
      )}

      {!firstLoad && !empty && (
        <p className="flex flex-wrap gap-x-3 text-xs text-muted">
          <span className="tabular-nums">
            {list.loading ? "Loading more…" : `${list.total} images waiting`}
          </span>
          <span>Enter opens the editor; A and R there accept or reject.</span>
        </p>
      )}
    </section>
  );
}
