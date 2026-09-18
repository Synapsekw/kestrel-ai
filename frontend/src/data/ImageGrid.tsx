import { useEffect, useState, type KeyboardEvent } from "react";
import { thumbnailUrl, type Image as ImageRow } from "@contract/client";
import { useBackend } from "@/api/client";
import { computeWindow, useVirtualRows } from "./useVirtualRows";
import type { ImageTableProps } from "./ImageTable";

export const CELL_WIDTH = 200;
export const CELL_HEIGHT = 190;

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
 * fallback stays neutral because the caption below already shows the file name.
 */
function Thumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="px-2 text-center text-xs text-slate-500">no thumbnail</span>;
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="max-h-full max-w-full object-contain"
    />
  );
}

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
      role="listbox"
      aria-label="Images"
      aria-multiselectable="true"
      data-testid="image-grid"
      className="min-h-0 flex-1 overflow-auto outline-none focus:ring-1 focus:ring-orange-500"
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
                role="option"
                aria-selected={isSelected}
                onClick={(e) =>
                  p.onCellClick(img.id, index, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })
                }
                onDoubleClick={() => p.onOpen(img.id)}
                style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
                className={`flex flex-col p-1.5 ${isFocused ? "ring-1 ring-inset ring-orange-500" : ""}`}
              >
                <div
                  className={`relative flex flex-1 items-center justify-center overflow-hidden rounded bg-slate-800 ${
                    isSelected ? "outline outline-2 outline-orange-500" : ""
                  }`}
                >
                  <Thumb key={src} src={src} alt={img.file_name} />
                  <input
                    type="checkbox"
                    aria-label={`Select ${img.file_name}`}
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => p.onToggle(img.id)}
                    className="absolute left-1 top-1"
                  />
                  <span className="absolute bottom-1 right-1 flex gap-1 text-[10px]">
                    {img.box_count > 0 && (
                      <span className="rounded bg-emerald-700 px-1">{img.box_count} boxes</span>
                    )}
                    {img.pending_count > 0 && (
                      <span className="rounded bg-amber-600 px-1">{img.pending_count} pending</span>
                    )}
                  </span>
                </div>
                <span className="mt-1 truncate text-xs text-slate-300" title={img.file_name}>
                  {img.file_name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
