import type { ReactNode } from "react";
import type { Image as ImageRow } from "@contract/client";
import type { ListImagesQuery } from "@/api/images";

export type ViewMode = "grid" | "list";
export type SortKey = NonNullable<ListImagesQuery["sort"]>;
export type Order = "asc" | "desc";
export type TriState = "all" | "yes" | "no";

export interface ImageFilters {
  search: string;
  sourceId: string;
  groupKey: string;
  labeled: TriState;
  pending: TriState;
  /** Client-side over the loaded rows: the contract has no box_count filter. */
  minBoxes: number | null;
  /** Client-side, `YYYY-MM-DD`, inclusive; the contract has no capture_time filter. */
  captureFrom: string;
  captureTo: string;
}

export interface ListQuery {
  filters: ImageFilters;
  sort: SortKey;
  order: Order;
}

export const DEFAULT_FILTERS: ImageFilters = {
  search: "",
  sourceId: "",
  groupKey: "",
  labeled: "all",
  pending: "all",
  minBoxes: null,
  captureFrom: "",
  captureTo: "",
};

export const DEFAULT_QUERY: ListQuery = { filters: DEFAULT_FILTERS, sort: "path", order: "asc" };

export function toImageParams(q: ListQuery, limit: number, cursor?: string): ListImagesQuery {
  const p: ListImagesQuery = { sort: q.sort, order: q.order, limit };
  if (cursor) p.cursor = cursor;
  const f = q.filters;
  if (f.search) p.search = f.search;
  if (f.sourceId) p.source_id = f.sourceId;
  if (f.groupKey) p.group_key = f.groupKey;
  if (f.labeled !== "all") p.labeled = f.labeled === "yes";
  if (f.pending !== "all") p.has_pending = f.pending === "yes";
  return p;
}

export function applyClientFilters(items: ImageRow[], f: ImageFilters): ImageRow[] {
  return items.filter((i) => {
    if (f.minBoxes !== null && i.box_count < f.minBoxes) return false;
    if (f.captureFrom || f.captureTo) {
      if (!i.capture_time) return false;
      const day = i.capture_time.slice(0, 10);
      if (f.captureFrom && day < f.captureFrom) return false;
      if (f.captureTo && day > f.captureTo) return false;
    }
    return true;
  });
}

export function toggleSort(q: ListQuery, key: SortKey): ListQuery {
  if (q.sort === key) return { ...q, order: q.order === "asc" ? "desc" : "asc" };
  return { ...q, sort: key, order: "asc" };
}

/** `YYYY-MM-DD HH:mm` in UTC, deterministic across locales. */
export function formatCaptureTime(iso: string | null): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "";
}

export interface RowContext {
  sourceNames: Record<string, string>;
}

export interface ColumnDef {
  key: string;
  label: string;
  sortKey?: SortKey;
  /** CSS grid track size */
  width: string;
  render: (img: ImageRow, ctx: RowContext) => ReactNode;
}

const fileColumn: ColumnDef = {
  key: "file",
  label: "File",
  sortKey: "path",
  width: "minmax(16rem, 2fr)",
  render: (i) => i.file_name,
};
const groupColumn: ColumnDef = {
  key: "group",
  label: "Group",
  sortKey: "group_key",
  width: "minmax(8rem, 1fr)",
  render: (i) => i.group_key,
};
const boxesColumn: ColumnDef = {
  key: "boxes",
  label: "Boxes",
  sortKey: "box_count",
  width: "5rem",
  render: (i) => i.box_count,
};
const pendingColumn: ColumnDef = {
  key: "pending",
  label: "Pending",
  sortKey: "pending_count",
  width: "5rem",
  render: (i) => i.pending_count,
};

export const DATA_COLUMNS: ColumnDef[] = [
  fileColumn,
  {
    key: "source",
    label: "Source",
    sortKey: "source_id",
    width: "minmax(6rem, 1fr)",
    render: (i, ctx) => ctx.sourceNames[i.source_id] ?? i.source_id.slice(0, 8),
  },
  groupColumn,
  {
    key: "labeled",
    label: "Labeled",
    sortKey: "labeled",
    width: "5rem",
    render: (i) => (i.marked_empty ? "empty" : i.labeled ? "yes" : "no"),
  },
  boxesColumn,
  pendingColumn,
  {
    key: "captured",
    label: "Captured",
    sortKey: "capture_time",
    width: "9rem",
    render: (i) => formatCaptureTime(i.capture_time),
  },
];

export const REVIEW_COLUMNS: ColumnDef[] = [
  fileColumn,
  groupColumn,
  pendingColumn,
  {
    key: "confidence",
    label: "Top confidence",
    sortKey: "max_pending_confidence",
    width: "8rem",
    render: (i) =>
      i.max_pending_confidence === null ? "" : `${Math.round(i.max_pending_confidence * 100)}%`,
  },
  boxesColumn,
];

export type ListKeyAction =
  | { type: "move"; delta: number }
  | { type: "open" }
  | { type: "toggle" }
  | { type: "select-all" }
  | { type: "clear" };

/** Spec section 6: J and K move, Enter opens; plus Space toggles selection, Ctrl+A selects all, Escape clears. */
export function keyboardAction(e: { key: string; ctrlKey: boolean; metaKey: boolean }): ListKeyAction | null {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "a") return { type: "select-all" };
  if (ctrl) return null;
  switch (e.key) {
    case "j":
    case "J":
    case "ArrowDown":
      return { type: "move", delta: 1 };
    case "k":
    case "K":
    case "ArrowUp":
      return { type: "move", delta: -1 };
    case "Enter":
      return { type: "open" };
    case " ":
      return { type: "toggle" };
    case "Escape":
      return { type: "clear" };
    default:
      return null;
  }
}
