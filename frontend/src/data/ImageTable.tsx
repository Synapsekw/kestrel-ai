import { useEffect, type KeyboardEvent, type MouseEvent } from "react";
import type { Image as ImageRow } from "@contract/client";
import { computeWindow, useVirtualRows } from "./useVirtualRows";
import type { ColumnDef, Order, RowContext, SortKey } from "./listModel";

export const ROW_HEIGHT = 36;

export interface ImageTableProps {
  items: ImageRow[];
  columns: ColumnDef[];
  rowContext: RowContext;
  sort?: { key: SortKey; order: Order };
  onSort?: (key: SortKey) => void;
  selected: ReadonlySet<string>;
  focusIndex: number;
  onRowClick: (id: string, index: number, mod: { shift: boolean; ctrl: boolean }) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onNearEnd?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}

function mods(e: MouseEvent): { shift: boolean; ctrl: boolean } {
  return { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
}

export function ImageTable(p: ImageTableProps) {
  const { onNearEnd, focusIndex } = p;
  const count = p.items.length;
  // Destructured at the top: the React Compiler `refs` rule rejects reading the ref through the
  // hook's return object during render.
  const { containerRef, onScroll, height, scrollTop, scrollToIndex } = useVirtualRows({
    rowHeight: ROW_HEIGHT,
  });
  const win = computeWindow(scrollTop, height, ROW_HEIGHT, count);
  const { end } = win;
  const template = `2rem ${p.columns.map((c) => c.width).join(" ")}`;

  useEffect(() => {
    if (onNearEnd && count > 0 && end >= count - 20) onNearEnd();
  }, [end, count, onNearEnd]);

  useEffect(() => scrollToIndex(focusIndex), [focusIndex, scrollToIndex]);

  return (
    <div role="grid" aria-rowcount={p.items.length} className="flex min-h-0 flex-1 flex-col">
      <div
        role="row"
        className="grid border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400"
        style={{ gridTemplateColumns: template }}
      >
        <span role="columnheader" aria-label="select" />
        {p.columns.map((c) =>
          p.onSort && c.sortKey ? (
            <button
              key={c.key}
              type="button"
              role="columnheader"
              onClick={() => p.onSort?.(c.sortKey as SortKey)}
              className="px-2 py-1.5 text-left hover:text-white"
            >
              {c.label}
              {p.sort?.key === c.sortKey ? (p.sort.order === "asc" ? " ▲" : " ▼") : ""}
            </button>
          ) : (
            <span key={c.key} role="columnheader" className="px-2 py-1.5">
              {c.label}
            </span>
          ),
        )}
      </div>
      <div
        ref={containerRef}
        onScroll={onScroll}
        tabIndex={0}
        onKeyDown={p.onKeyDown}
        data-testid="image-table"
        className="min-h-0 flex-1 overflow-auto outline-none focus:ring-1 focus:ring-orange-500"
      >
        <div style={{ height: win.totalHeight, position: "relative" }}>
          <div style={{ position: "absolute", top: win.offsetTop, left: 0, right: 0 }}>
            {p.items.slice(win.start, win.end).map((img, i) => {
              const index = win.start + i;
              const isSelected = p.selected.has(img.id);
              const isFocused = index === p.focusIndex;
              return (
                <div
                  key={img.id}
                  role="row"
                  aria-selected={isSelected}
                  onClick={(e) => p.onRowClick(img.id, index, mods(e))}
                  onDoubleClick={() => p.onOpen(img.id)}
                  style={{ gridTemplateColumns: template, height: ROW_HEIGHT }}
                  className={`grid cursor-default items-center border-b border-slate-800/60 text-sm ${
                    isSelected ? "bg-orange-900/40" : "hover:bg-slate-800/60"
                  } ${isFocused ? "ring-1 ring-inset ring-orange-500" : ""}`}
                >
                  <span role="gridcell" className="flex justify-center">
                    <input
                      type="checkbox"
                      aria-label={`Select ${img.file_name}`}
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => p.onToggle(img.id)}
                    />
                  </span>
                  {p.columns.map((c) => (
                    <span key={c.key} role="gridcell" className="truncate px-2">
                      {c.render(img, p.rowContext)}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
