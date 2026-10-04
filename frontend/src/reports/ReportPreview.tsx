import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  useReportAssetSrc,
  useSnapshotSrc,
  type LoadBlocks,
  type OutlineSection,
  type ReportOutline,
  type SectionKey,
  type SnapshotRef,
} from "@/api/reports";
import { countLabel } from "@/lib/countLabel";
import { Button, EmptyState, cx, useReducedMotion } from "@/ui";
import { BlockView } from "./preview/blocks/BlockView";
import { useFlip } from "./preview/flip";
import { paginate, type Sheet } from "./preview/paginate";
import { PreviewEnvContext, type CoverBrand, type PreviewEnv } from "./preview/PreviewContext";
import { useSectionBlocks, type SectionEntry } from "./preview/sectionBlocks";
import { useInView } from "./preview/useInView";
import { PRINT, mm, mmVar, paperOf, pt, type PaperSize } from "./printTheme";
import "./preview.css";

/** A section asks for its next page when it is this close to the preview's viewport. */
export const SECTION_MARGIN = "1200px 0px";
const SHEET_GAP_PX = 24; // gap-6 between sheets

export interface ReportPreviewProps {
  projectId: string;
  /** null while the outline loads. */
  outline: ReportOutline | null;
  /** Stable for one source; remount with a `key` to switch draft <-> version (Ruling 9). */
  loadBlocks: LoadBlocks;
  /** Pages of the last render; null or absent when the report was never rendered. */
  pageCount?: number | null;
  paper?: PaperSize;
  /** Overrides the snapshot URL (gallery, tests); defaults to the backend's snapshot endpoint. */
  resolveSnapshot?: (ref: SnapshotRef) => string | null;
  /** Overrides a report asset's URL (the cover logo); defaults to the backend's asset endpoint (Ruling R-6). */
  resolveAsset?: (assetId: string) => string | null;
  /** The report's brand for the cover (spec 2026-10-02-asset-findings §9); null is the Kestrel theme. */
  brand?: CoverBrand | null;
  /** The host sizes the preview (it is its own scroll container, Ruling 8). */
  className?: string;
}

export interface ReportPreviewHandle {
  scrollToSection: (key: SectionKey) => void;
}

const NO_SECTIONS: OutlineSection[] = [];

export const ReportPreview = forwardRef<ReportPreviewHandle, ReportPreviewProps>(function ReportPreview(
  {
    projectId,
    outline,
    loadBlocks,
    pageCount,
    paper = "A4",
    resolveSnapshot,
    resolveAsset,
    brand = null,
    className,
  },
  ref,
) {
  const backendSrc = useSnapshotSrc(projectId);
  const backendAsset = useReportAssetSrc(projectId);
  // Held in state so the observers re-root once the scroller mounts (Ruling 8).
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const env = useMemo<PreviewEnv>(
    () => ({
      resolveSnapshot: resolveSnapshot ?? backendSrc,
      resolveAsset: resolveAsset ?? backendAsset,
      scrollRoot: root,
      paper,
      brand,
    }),
    [resolveSnapshot, backendSrc, resolveAsset, backendAsset, root, paper, brand],
  );
  const sections = outline?.sections ?? NO_SECTIONS;
  const { entryOf, request, retry } = useSectionBlocks(loadBlocks);
  const reduced = useReducedMotion();

  useImperativeHandle(
    ref,
    () => ({
      scrollToSection: (key) => {
        const el = root?.querySelector(`[data-section-key="${key}"]`);
        el?.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });
      },
    }),
    [root, reduced],
  );
  useFlip(root, sections.map((s) => s.key).join("|"), reduced);

  const estimated = sections.reduce((n, s) => n + s.estimated_pages, 0);
  const column = {
    "--mm": mmVar(paper),
    width: mm(paperOf(paper).width_mm),
    maxWidth: "100%",
  } as CSSProperties;

  return (
    <PreviewEnvContext.Provider value={env}>
      <div
        ref={setRoot}
        role="region"
        aria-label="Preview"
        className={cx("h-full overflow-y-auto px-6 pb-10", className)}
        style={{ containerType: "inline-size" }}
      >
        <div data-testid="preview-column" className="mx-auto flex flex-col gap-6" style={column}>
          <PageCountLine pageCount={pageCount ?? null} estimated={outline ? estimated : null} />
          {outline === null ? (
            <SheetSkeleton paper={paper} loading />
          ) : sections.length === 0 ? (
            <EmptyState icon="report" title="No sections enabled">
              Turn a section on to see it here.
            </EmptyState>
          ) : (
            sections.map((s) => (
              <SectionView
                key={s.key}
                section={s}
                entry={entryOf(s)}
                paper={paper}
                request={request}
                retry={retry}
              />
            ))
          )}
        </div>
      </div>
    </PreviewEnvContext.Provider>
  );
});

function PageCountLine({ pageCount, estimated }: { pageCount: number | null; estimated: number | null }) {
  const last =
    pageCount === null ? "Not rendered yet" : `${countLabel(pageCount, "page", "pages")} at the last render`;
  const now = estimated === null ? "" : ` · about ${countLabel(estimated, "page", "pages")} now`;
  return <p className="pt-4 text-right text-xs text-muted tabular-nums">{`${last}${now}`}</p>;
}

function SectionView({
  section,
  entry,
  paper,
  request,
  retry,
}: {
  section: OutlineSection;
  entry: SectionEntry;
  paper: PaperSize;
  request: (s: OutlineSection) => void;
  retry: (s: OutlineSection) => void;
}) {
  const [sectionRef, sectionNear] = useInView<HTMLElement>(SECTION_MARGIN);
  const [tailRef, tailNear] = useInView<HTMLDivElement>(SECTION_MARGIN);
  const first = entry.blocks.length === 0;
  const near = first ? sectionNear : tailNear;
  const needs = entry.status === "idle" && !entry.done;
  useEffect(() => {
    if (near && needs) request(section);
  }, [near, needs, entry.blocks.length, request, section]);

  // Old blocks stay (dimmed) only while the new first page is pending; a section edited down to
  // nothing is done at once and must show its empty sheet, not the deleted blocks.
  const showingStale = first && !entry.done && entry.stale !== null && entry.stale.length > 0;
  const sheets = useMemo(
    () => paginate(section.key, showingStale ? (entry.stale ?? []) : entry.blocks),
    [section.key, showingStale, entry.stale, entry.blocks],
  );
  const remaining = entry.done ? 0 : Math.max(section.estimated_pages - sheets.length, 1);
  const titleId = `report-section-${section.key}`;
  const onRetry = useCallback(() => retry(section), [retry, section]);
  // A failed refetch keeps the stale blocks but is not busy: nothing is loading until Retry.
  const busy = entry.status === "loading" || (showingStale && entry.status !== "error");

  return (
    <section
      ref={sectionRef}
      data-section-key={section.key}
      aria-labelledby={titleId}
      aria-busy={busy}
      className="flex flex-col gap-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={titleId} className="text-sm font-medium text-ink">
          {section.title}
        </h3>
        {entry.status === "error" ? (
          <span className="flex items-center gap-2 text-xs text-danger" title={entry.error ?? undefined}>
            Could not load this section.
            <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
              Retry
            </Button>
          </span>
        ) : (
          <span className="text-xs text-muted tabular-nums">
            {countLabel(section.estimated_pages, "page", "pages")}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-6" style={showingStale ? { opacity: 0.55 } : undefined}>
        {sheets.map((sheet) => (
          <PaperSheet key={sheet.id} sheet={sheet} paper={paper} />
        ))}
      </div>
      {entry.done && sheets.length === 0 ? <EmptySheet paper={paper} /> : null}
      {!entry.done && !showingStale ? (
        <div ref={tailRef} data-testid={`pending-${section.key}`}>
          <SheetSkeleton paper={paper} loading={entry.status === "loading"} extraPages={remaining - 1} />
        </div>
      ) : null}
      {showingStale ? <div ref={tailRef} data-testid={`pending-${section.key}`} /> : null}
    </section>
  );
}

function sheetStyle(paper: PaperSize): CSSProperties {
  return {
    background: PRINT.paper,
    color: PRINT.ink,
    minHeight: mm(paperOf(paper).height_mm),
    padding: mm(PRINT.margin),
    borderRadius: mm(1),
  };
}

/** Ruling R-6: a cover sheet has no padding; its `cover` block draws the full-bleed band and its own margins. */
function PaperSheet({ sheet, paper }: { sheet: Sheet; paper: PaperSize }) {
  const cover = sheet.kind === "cover";
  const style: CSSProperties = cover ? { ...sheetStyle(paper), padding: 0 } : sheetStyle(paper);
  return (
    <div
      data-sheet={sheet.kind}
      className={cx("relative font-sans shadow-elev-1", cover && "overflow-hidden")}
      style={style}
    >
      {sheet.blocks.map((b, i) => (
        <BlockView key={b.kind === "finding" ? b.finding_id : i} block={b} />
      ))}
    </div>
  );
}

function EmptySheet({ paper }: { paper: PaperSize }) {
  return (
    <div data-sheet="flow" className="shadow-elev-1" style={sheetStyle(paper)}>
      <p style={{ color: PRINT.muted, fontSize: pt(PRINT.size.body), margin: 0 }}>
        Nothing to show in this section.
      </p>
    </div>
  );
}

/** Paper skeleton (Ruling 14): shimmers only while a request runs; a spacer keeps the scroll height. */
function SheetSkeleton({
  paper,
  loading,
  extraPages = 0,
}: {
  paper: PaperSize;
  loading: boolean;
  extraPages?: number;
}) {
  const h = paperOf(paper).height_mm;
  return (
    <>
      <div role="status" aria-label="Loading section" className="shadow-elev-1" style={sheetStyle(paper)}>
        {[70, 100, 92, 100, 64].map((w, i) => (
          <div
            key={i}
            className={loading ? "animate-shimmer" : undefined}
            style={{
              width: `${w}%`,
              height: mm(i === 0 ? 7 : 3.5),
              marginBottom: mm(i === 0 ? 6 : 3),
              background: PRINT.head,
              borderRadius: mm(1),
            }}
          />
        ))}
      </div>
      {extraPages > 0 ? (
        <div
          aria-hidden="true"
          style={{ height: `calc(${mm(h * extraPages)} + ${SHEET_GAP_PX * extraPages}px)` }}
        />
      ) : null}
    </>
  );
}
