import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ClassDef } from "@contract/client";
import { useBackend } from "@/api/client";
import { findingThumbnailUrl, type Finding } from "@/api/findings";
import { computeWindow, cx, focusRing, SeverityPill, transition, useVirtualRows } from "@/ui";
import { assetFacts, formatFindingNumber } from "./format";
import { GALLERY_CAPTION, GALLERY_GAP, galleryGeometry } from "./galleryGeometry";
import { findingLocation } from "./location";

const OVERSCAN_ROWS = 2;
/** Rows from the end at which the next page is asked for. */
const END_ROWS = 2;
/** A finding whose type left the project still shows an outline, in the muted ink. */
const UNKNOWN_TYPE_COLOUR = "rgb(var(--muted))";

export interface FindingGalleryProps {
  projectId: string;
  /** The loaded pages only; the caller appends a page on onEndReached (as DataTable's). */
  items: readonly Finding[];
  types: ReadonlyMap<string, ClassDef>;
  labels: ReadonlyMap<string, string>;
  zoneLabels: ReadonlyMap<string, string>;
  activeKey: string | null;
  loading: boolean;
  onOpen: (f: Finding) => void;
  onEndReached?: () => void;
}

function FindingTile({
  projectId,
  finding,
  colour,
  typeName,
  subtitle,
  active,
  thumbH,
  onOpen,
}: {
  projectId: string;
  finding: Finding;
  colour: string;
  typeName: string;
  subtitle: string;
  active: boolean;
  thumbH: number;
  onOpen: (f: Finding) => void;
}) {
  const { baseUrl, token } = useBackend();
  const [failed, setFailed] = useState(false);
  const number = formatFindingNumber(finding.number);
  return (
    <div role="listitem" className="min-w-0">
      <button
        type="button"
        aria-label={`${number} ${typeName}`}
        aria-current={active || undefined}
        onClick={() => onOpen(finding)}
        style={{ "--c": colour } as CSSProperties}
        className={cx(
          "flex w-full flex-col overflow-hidden rounded-card border bg-surface text-left",
          active ? "border-accent" : "border-card-line hover:border-line-strong",
          transition,
          focusRing,
        )}
      >
        <span className="relative block w-full bg-surface-2" style={{ height: thumbH }}>
          {failed ? (
            <span
              aria-hidden
              data-testid="gallery-thumb-fallback"
              className="absolute inset-6 rounded-sm border-2 border-[color:var(--c)]"
            />
          ) : (
            <img
              src={findingThumbnailUrl(baseUrl, token, projectId, finding.id)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
              className="h-full w-full object-cover"
            />
          )}
        </span>
        <span className="flex flex-col justify-center gap-0.5 px-2.5" style={{ height: GALLERY_CAPTION }}>
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs tabular-nums text-ink">{number}</span>
            <SeverityPill level={finding.severity} />
          </span>
          <span className="truncate text-2xs text-muted">{subtitle}</span>
        </span>
      </button>
    </div>
  );
}

/**
 * Spec §9 Register Gallery: finding thumbnails (the representative sighting's crop) in a virtualised
 * grid. Only the visible rows render; thumbnails load lazily; paging is the table's keyset cursor.
 */
export function FindingGallery({
  projectId,
  items,
  types,
  labels,
  zoneLabels,
  activeKey,
  loading,
  onOpen,
  onEndReached,
}: FindingGalleryProps) {
  // Rows are sized from the measured width; `rowHeight` here only feeds scrollToIndex, unused.
  const { containerRef, onScroll, width, height, scrollTop } = useVirtualRows({ rowHeight: 1 });
  const geo = galleryGeometry(width);
  const rowCount = Math.ceil(items.length / geo.cols);
  const win = computeWindow(scrollTop, height, geo.rowH, rowCount, OVERSCAN_ROWS);
  const askedAt = useRef(-1);
  useEffect(() => {
    if (!onEndReached || loading || rowCount === 0) return;
    if (win.end >= rowCount - END_ROWS && askedAt.current !== items.length) {
      askedAt.current = items.length;
      onEndReached();
    }
  }, [win.end, rowCount, items.length, loading, onEndReached]);

  const rows = Array.from({ length: win.end - win.start }, (_, i) => win.start + i);
  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      role="list"
      aria-label="Findings gallery"
      aria-busy={loading || undefined}
      className="h-full overflow-auto"
    >
      <div className="relative" style={{ height: win.totalHeight }}>
        {rows.map((r) => (
          <div
            key={r}
            className="absolute inset-x-0 grid"
            style={{
              top: r * geo.rowH,
              gridTemplateColumns: `repeat(${geo.cols}, minmax(0, 1fr))`,
              columnGap: GALLERY_GAP,
            }}
          >
            {items.slice(r * geo.cols, (r + 1) * geo.cols).map((f) => {
              const t = types.get(f.type_id);
              return (
                <FindingTile
                  key={f.id}
                  projectId={projectId}
                  finding={f}
                  colour={t?.colour ?? UNKNOWN_TYPE_COLOUR}
                  typeName={t?.name ?? "Unknown type"}
                  subtitle={assetFacts(f, zoneLabels) ?? findingLocation(f, labels).primary}
                  active={f.id === activeKey}
                  thumbH={geo.thumbH}
                  onOpen={onOpen}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
