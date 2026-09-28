import { useEffect, useMemo, type CSSProperties, type MouseEvent } from "react";
import { thumbnailUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import { clickSelect, type SelectionState } from "@/data/selection";
import {
  Alert,
  Button,
  cx,
  EmptyState,
  focusRing,
  Icon,
  severityOf,
  Skeleton,
  useReducedMotion,
  useSeverityScale,
} from "@/ui";
import { computeWindow, useVirtualRows } from "@/ui/useVirtualRows";
import { SORT_LABEL, type BrowserSort } from "./filters";
import { plural, sentence, stemOf } from "./format";
import { GRID_GAP, GRID_OVERSCAN, gridGeometry, scrollTargetFor, visibleRange } from "./gridGeometry";
import { useImageDetails } from "./useImageDetails";
import { FLAG_GPS, FLAG_REVIEWED, type ImageIndexState } from "./useImageIndex";
import { useThumb } from "./thumbs";

export interface BrowserGridProps {
  projectId: string;
  index: ImageIndexState;
  currentId: string | null;
  sort: BrowserSort;
  order: "asc" | "desc";
  selection: SelectionState;
  onSelectionChange: (next: SelectionState) => void;
  onOpen: (id: string) => void;
}

interface TileProps {
  ordinal: number;
  src: string;
  stem: string | null;
  sev: number;
  count: number;
  flags: number;
  current: boolean;
  selected: boolean;
  height: number;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

function Tile(p: TileProps) {
  const thumb = useThumb(p.src);
  const scale = useSeverityScale();
  const level = severityOf(scale, p.sev > 0 ? p.sev : null);
  const reviewed = (p.flags & FLAG_REVIEWED) !== 0;
  const located = (p.flags & FLAG_GPS) !== 0;
  const name = p.stem ?? `Image ${p.ordinal + 1}`;
  return (
    <div role="listitem" data-ordinal={p.ordinal} style={{ height: p.height }}>
      <button
        type="button"
        data-testid="image-thumb"
        aria-current={p.current ? "true" : undefined}
        aria-pressed={p.selected}
        aria-label={p.count > 0 ? `${name}, ${plural(p.count, "finding")}` : name}
        onClick={p.onClick}
        className={cx(
          "group relative block h-full w-full overflow-hidden rounded-sm border bg-surface-2",
          "transition-transform duration-base ease-out hover:-translate-y-0.5 hover:scale-[1.03]",
          "reduce-motion:transition-none reduce-motion:hover:translate-y-0 reduce-motion:hover:scale-100",
          p.current
            ? "border-accent ring-[3px] ring-accent/40"
            : p.selected
              ? "border-accent-ink ring-2 ring-accent-ink/60"
              : "border-line",
          focusRing,
        )}
      >
        {thumb.src ? (
          <img src={thumb.src} alt="" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <Skeleton className="h-full w-full rounded-none" />
        )}
        {p.count > 0 && (
          <span
            data-part="badge"
            className="absolute right-1 top-1 rounded-chip bg-[color:var(--c)] px-1.5 font-mono text-2xs leading-4 text-bg"
            style={{ "--c": level?.colour ?? "rgb(var(--muted))" } as CSSProperties}
            title={`${plural(p.count, "finding")}${level ? `, worst ${level.name}` : ""}`}
          >
            {p.count}
          </span>
        )}
        {reviewed && (
          <span className="absolute left-1 top-1 text-ok" title="Reviewed">
            <Icon name="check" size={12} />
          </span>
        )}
        {!located && (
          <span className="absolute bottom-5 left-1 text-dim" title="No location">
            <Icon name="pin" size={11} />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-bg to-transparent px-1.5 pb-0.5 pt-3 text-left font-mono text-2xs text-ink">
          {p.stem ?? ""}
        </span>
      </button>
    </div>
  );
}

/**
 * Spec §6.1 / §7.2: the browser's virtualised 3-column grid over the columnar index. Only the rows
 * in view plus 3 rows of overscan are mounted; details are read for those rows only. At the fallback
 * viewport (height 600, width 256 → rowH 67.5) `computeWindow` clamps `start` at 0, so the initial
 * window is rows 0–12 (12 rows = 36 tiles), comfortably under the 60-tile budget the tests assert.
 */
export function BrowserGrid(p: BrowserGridProps) {
  const { baseUrl, token } = useBackend();
  const reduced = useReducedMotion();
  // Our own scroll logic below; the hook's rowHeight feeds only its scrollToIndex, unused here.
  const { containerRef, onScroll, width, height, scrollTop } = useVirtualRows({ rowHeight: 1 });
  const { cols, cellH, rowH } = gridGeometry(width);
  const total = p.index.total;
  const rows = Math.ceil(total / cols);
  const win = computeWindow(scrollTop, height, rowH, rows, GRID_OVERSCAN);
  const first = win.start * cols;
  const last = Math.min(total, win.end * cols);
  const windowIds = useMemo(() => p.index.ids.slice(first, last), [p.index.ids, first, last]);
  const details = useImageDetails(p.projectId, windowIds);
  const currentOrdinal = p.index.ordinalOf(p.currentId);

  // Navigation keeps the current thumb visible; smooth only for short jumps (§7.2).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || currentOrdinal < 0) return;
    const target = scrollTargetFor(currentOrdinal, rowH, cols, el.scrollTop, el.clientHeight || height);
    if (!target) return;
    if (target.smooth && !reduced && typeof el.scrollTo === "function")
      el.scrollTo({ top: target.top, behavior: "smooth" });
    else el.scrollTop = target.top;
    onScroll();
  }, [currentOrdinal, rowH, cols, height, reduced, containerRef, onScroll]);

  const onTile = (id: string) => (e: MouseEvent<HTMLButtonElement>) => {
    const mod = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    if (mod.shift || mod.ctrl) {
      p.onSelectionChange(clickSelect(p.selection, p.index.ids as string[], id, mod));
      return;
    }
    p.onSelectionChange({ selected: new Set(), anchor: id });
    p.onOpen(id);
  };

  const range = visibleRange(scrollTop, height, rowH, cols, total);
  // Before the first answer there is nothing to count yet: "0 images" would be a false claim.
  const caption =
    p.index.status === "loading" && total === 0
      ? "Loading images…"
      : total === 0
        ? "0 images"
        : `${range.from}–${range.to} of ${total} · by ${SORT_LABEL[p.sort]} ${p.order === "asc" ? "↑" : "↓"}`;

  if (p.index.status === "error") {
    return p.index.errorCode === "too_many_images" ? (
      <Alert tone="warn" role="alert" title="Too many images to list">
        More than 100,000 images match. Pick a flight to narrow the list.
      </Alert>
    ) : (
      <Alert
        tone="danger"
        role="alert"
        title="The images could not be listed"
        actions={
          <Button size="sm" onClick={p.index.reload}>
            Try again
          </Button>
        }
      >
        {sentence(p.index.error ?? "")}
      </Alert>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="font-mono text-2xs text-muted" data-testid="grid-caption">
        {caption}
      </p>
      {p.index.status === "ready" && total === 0 ? (
        <EmptyState icon="images" title="No images match these filters." />
      ) : (
        <div
          ref={containerRef}
          onScroll={onScroll}
          role="list"
          aria-label="Images"
          data-testid="browser-grid"
          className="min-h-0 flex-1 overflow-auto"
        >
          <div style={{ height: win.totalHeight, position: "relative" }}>
            <div
              className="grid"
              style={{
                position: "absolute",
                top: win.offsetTop,
                left: 0,
                right: 0,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                columnGap: GRID_GAP,
                rowGap: GRID_GAP,
              }}
            >
              {windowIds.map((id, i) => {
                const ordinal = first + i;
                const row = details.get(id);
                return (
                  <Tile
                    key={id}
                    ordinal={ordinal}
                    src={thumbnailUrl(baseUrl, token, p.projectId, id)}
                    stem={row ? stemOf(row.file_name) : null}
                    sev={p.index.sev[ordinal] ?? 0}
                    count={p.index.count[ordinal] ?? 0}
                    flags={p.index.flags[ordinal] ?? 0}
                    current={ordinal === currentOrdinal}
                    selected={p.selection.selected.has(id)}
                    height={cellH}
                    onClick={onTile(id)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
