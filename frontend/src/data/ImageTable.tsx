import { useEffect, type KeyboardEvent, type MouseEvent } from "react";
import type { Image as ImageRow } from "@contract/client";
import { Button, Checkbox, Icon, cx } from "@/ui";
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

/** Columns whose values are counts or percentages: set in tabular figures. */
const NUMERIC = new Set(["boxes", "pending", "confidence"]);

function mods(e: MouseEvent): { shift: boolean; ctrl: boolean } {
  return { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
}

/** Keeps a click on the checkbox from also reaching the row (select) or opening it (double-click). */
const stop = (e: MouseEvent) => e.stopPropagation();

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
  const template = `2.5rem ${p.columns.map((c) => c.width).join(" ")}`;

  useEffect(() => {
    if (onNearEnd && count > 0 && end >= count - 20) onNearEnd();
  }, [end, count, onNearEnd]);

  useEffect(() => scrollToIndex(focusIndex), [focusIndex, scrollToIndex]);

  return (
    <div
      role="grid"
      aria-rowcount={p.items.length}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel text-[13px]"
    >
      <div
        role="row"
        className="grid h-9 shrink-0 items-center border-b border-line text-xs font-medium text-muted"
        style={{ gridTemplateColumns: template }}
      >
        <span role="columnheader" aria-label="select" />
        {p.columns.map((c) => {
          const sorted = p.sort && p.sort.key === c.sortKey ? p.sort.order : null;
          return p.onSort && c.sortKey ? (
            <Button
              key={c.key}
              variant="ghost"
              size="sm"
              role="columnheader"
              aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
              onClick={() => p.onSort?.(c.sortKey as SortKey)}
              className="group w-full px-2"
            >
              <span className="flex w-full items-center gap-1 text-left text-xs text-muted group-hover:text-ink">
                {c.label}
                {sorted && (
                  <Icon
                    name="chevron-down"
                    size={12}
                    className={cx("text-ink", sorted === "asc" && "rotate-180")}
                  />
                )}
              </span>
            </Button>
          ) : (
            <span key={c.key} role="columnheader" className="px-2">
              {c.label}
            </span>
          );
        })}
      </div>
      <div
        ref={containerRef}
        onScroll={onScroll}
        tabIndex={0}
        onKeyDown={p.onKeyDown}
        data-testid="image-table"
        className="min-h-0 flex-1 overflow-auto outline-none"
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
                  className={cx(
                    "grid h-9 cursor-default items-center border-b border-line text-ink transition-colors duration-140 ease-out motion-reduce:transition-none",
                    isSelected ? "bg-accent-soft/60" : "hover:bg-hover",
                    isFocused && "ring-2 ring-inset ring-accent/60",
                  )}
                >
                  <span role="gridcell" className="flex justify-center" onClick={stop} onDoubleClick={stop}>
                    <Checkbox
                      aria-label={`Select ${img.file_name}`}
                      checked={isSelected}
                      onChange={() => p.onToggle(img.id)}
                    />
                  </span>
                  {p.columns.map((c) => (
                    <span
                      key={c.key}
                      role="gridcell"
                      className={cx(
                        "truncate px-2",
                        c.key === "file" && "font-mono text-[13px]",
                        NUMERIC.has(c.key) && "tabular-nums",
                      )}
                    >
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
