import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { thumbnailUrl, type Image as ImageRow } from "@contract/client";
import { useBackend } from "@/api/client";
import { Checkbox, cx, transition } from "@/ui";
import { computeWindow, useVirtualRows } from "@/ui/useVirtualRows";
import type { ImageTableProps } from "./ImageTable";

export const CELL_WIDTH = 232;
export const CELL_HEIGHT = 218;

export interface ImageGridProps {
  projectId: string;
  items: ImageRow[];
  selected: ReadonlySet<string>;
  focusIndex: number;
  onCellClick: ImageTableProps["onRowClick"];
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onNearEnd?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Mounted with `key={src}` by the grid so a new source starts un-failed without an effect. The
 * fallback stays neutral because the caption already shows the file name.
 */
function Thumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="px-2 text-center text-xs text-muted">No thumbnail</span>;
  return <img src={src} alt={alt} onError={() => setFailed(true)} className="h-full w-full object-cover" />;
}

/** Top-right state of a tile: suggestions waiting beat marked empty beat labeled. */
function StatusBadge({ img }: { img: ImageRow }) {
  const base =
    "inline-flex h-[18px] items-center rounded-full px-1.5 text-[10px] font-semibold leading-none shadow-sm";
  if (img.pending_count > 0)
    return (
      <span
        className={cx(base, "bg-warn text-accent-fg")}
        title={`${img.pending_count} ${img.pending_count === 1 ? "suggestion" : "suggestions"} to review`}
      >
        Review
      </span>
    );
  if (img.marked_empty) return <span className={cx(base, "bg-surface text-muted")}>Empty</span>;
  if (img.labeled) return <span className={cx(base, "bg-ok text-bg")}>Labeled</span>;
  return null;
}

/** Keeps a click on the checkbox from also reaching the tile (select) or opening it (double-click). */
const stop = (e: MouseEvent) => e.stopPropagation();

export function ImageGrid(p: ImageGridProps) {
  const { baseUrl, token } = useBackend();
  const { onNearEnd, focusIndex } = p;
  const count = p.items.length;
  // Columns are derived from the measured width; the first render (width 0) uses one column.
  // Destructured at the top: the React Compiler `refs` rule rejects reading the ref through the
  // hook's return object during render.
  const { containerRef, onScroll, width, height, scrollTop, scrollToIndex } = useVirtualRows({
    rowHeight: CELL_HEIGHT,
  });
  const cols = Math.max(1, Math.floor((width || CELL_WIDTH) / CELL_WIDTH));
  const rows = Math.ceil(count / cols);
  const win = computeWindow(scrollTop, height, CELL_HEIGHT, rows, 2);
  const { end } = win;

  useEffect(() => {
    if (onNearEnd && count > 0 && end * cols >= count - 20) onNearEnd();
  }, [end, cols, count, onNearEnd]);

  useEffect(() => scrollToIndex(Math.floor(focusIndex / cols)), [focusIndex, cols, scrollToIndex]);

  const visible = p.items.slice(win.start * cols, win.end * cols);
  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      tabIndex={0}
      onKeyDown={p.onKeyDown}
      role="list"
      aria-label="Images"
      data-testid="image-grid"
      className="-mx-1.5 min-h-0 flex-1 overflow-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
    >
      <div style={{ height: win.totalHeight, position: "relative" }}>
        <div
          className="flex flex-wrap"
          style={{ position: "absolute", top: win.offsetTop, left: 0, right: 0 }}
        >
          {visible.map((img, i) => {
            const index = win.start * cols + i;
            const isSelected = p.selected.has(img.id);
            const isFocused = index === p.focusIndex;
            const src = thumbnailUrl(baseUrl, token, p.projectId, img.id);
            return (
              <div
                key={img.id}
                // A list item rather than an option: the checkbox inside must stay a real control.
                role="listitem"
                aria-current={isFocused ? "true" : undefined}
                onClick={(e) =>
                  p.onCellClick(img.id, index, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })
                }
                onDoubleClick={() => p.onOpen(img.id)}
                style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
                className="group flex p-1.5"
              >
                <div
                  className={cx(
                    "relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-surface",
                    transition,
                    isSelected
                      ? "border-accent ring-2 ring-accent"
                      : isFocused
                        ? "border-line ring-2 ring-ink/40"
                        : "border-line",
                  )}
                >
                  <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-bg">
                    <Thumb key={src} src={src} alt={img.file_name} />
                  </div>
                  <span
                    className={cx(
                      "absolute left-1.5 top-1.5 flex",
                      transition,
                      isSelected || isFocused
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                    )}
                    onClick={stop}
                    onDoubleClick={stop}
                  >
                    <Checkbox
                      onDark
                      aria-label={`Select ${img.file_name}`}
                      checked={isSelected}
                      onChange={() => p.onToggle(img.id)}
                    />
                  </span>
                  <span className="absolute right-1.5 top-1.5 flex">
                    <StatusBadge img={img} />
                  </span>
                  <span className="flex w-full shrink-0 flex-col gap-1 border-t border-line px-3 py-2 text-xs text-ink">
                    <span className="min-w-0 truncate font-mono" title={img.file_name}>
                      {img.file_name}
                    </span>
                    {img.box_count > 0 && (
                      <span className="shrink-0 tabular-nums text-muted">
                        {img.box_count} {img.box_count === 1 ? "box" : "boxes"}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
