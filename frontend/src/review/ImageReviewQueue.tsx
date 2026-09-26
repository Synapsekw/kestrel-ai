import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import type { useImageList } from "@/data/useImageList";
import { isTypingTarget } from "@/ui/keymap";
import { useNavigationStore } from "@/store/navigation";
import { Alert, SkeletonRows } from "@/ui";

export interface ImageReviewQueueProps {
  projectId: string;
  /** The queue's pages; the caller owns the query (a run's images, a source, the whole project). */
  list: ReturnType<typeof useImageList>;
  /** Shown when nothing waits. */
  empty: ReactNode;
}

/**
 * Images with unreviewed suggestions, highest confidence first; Enter opens the editor, where A and
 * R accept or reject (spec section 6 screen 4). Used by the training Review screen and by a photo
 * source in detection review.
 */
export function ImageReviewQueue({ projectId, list, empty: emptyState }: ImageReviewQueueProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const sourceNames = useSourceNames(projectId);
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
    <>
      {list.error && <Alert tone="danger">{list.error}</Alert>}

      {empty && (
        <div data-testid="review-empty" className="animate-reveal reduce-motion:animate-none">
          {emptyState}
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
    </>
  );
}
