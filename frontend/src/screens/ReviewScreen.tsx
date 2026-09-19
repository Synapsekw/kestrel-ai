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

/** Spec section 6 screen 4: images with unreviewed proposals sorted by proposal confidence, same editor. */
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
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-sm text-slate-400">
          Images with unreviewed proposals, highest proposal confidence first. Enter opens the editor; A and R
          there accept or reject.
        </p>
        {runIds && (
          <p data-testid="run-filter" className="text-sm text-slate-300">
            {list.loading
              ? "Loading the images of this detection run…"
              : `${list.total} of the ${runIds.split(",").length} images of this detection run still have proposals to review.`}{" "}
            <Link to={`/p/${projectId}/review`} className="text-orange-300 hover:underline">
              Show the whole queue
            </Link>
          </p>
        )}
      </div>
      {list.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {list.error}
        </p>
      )}
      {!list.loading && !list.error && list.items.length === 0 && (
        <div
          data-testid="review-empty"
          className="rounded border border-slate-800 bg-slate-800/30 p-4 text-sm"
        >
          <p className="font-medium">Nothing to review.</p>
          <p className="mt-1 text-slate-400">
            Proposals appear here after a detection run on the{" "}
            <Link to={`/p/${projectId}/query`} className="text-orange-300 hover:underline">
              Query screen
            </Link>
            , or when the editor opens an image while a pre-annotation model is set in the{" "}
            <Link to={`/p/${projectId}/settings`} className="text-orange-300 hover:underline">
              Project settings
            </Link>
            .
          </p>
        </div>
      )}
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
      <p className="text-xs text-slate-400">{list.loading ? "Loading…" : `${list.total} images waiting`}</p>
    </section>
  );
}
