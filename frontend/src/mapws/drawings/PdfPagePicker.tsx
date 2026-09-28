import type { DrawingPage } from "@/api/drawings";
import { Alert, Field, Input, Segmented, cx, focusRing, transition } from "@/ui";
import { DPI_CHOICES, fitDpi, renderSize, type DpiChoice } from "./drawingImport";

/** Spec §8.2: pick a page (thumbnails for the first 50) and a DPI, lowered to fit the caps. */
export function PdfPagePicker({
  pages,
  pageCount,
  page,
  dpi,
  onChange,
  thumbUrl,
}: {
  pages: readonly DrawingPage[];
  pageCount: number;
  page: number;
  dpi: DpiChoice;
  onChange: (patch: { page?: number; dpi?: DpiChoice }) => void;
  thumbUrl: (page: number) => string;
}) {
  const current = pages.find((p) => p.page === page);
  const fitted = current ? fitDpi(current, dpi) : null;
  const size = current && fitted ? renderSize(current, fitted.renderDpi) : null;
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Page" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {pages.map((p) => (
          <button
            key={p.page}
            type="button"
            role="radio"
            aria-checked={p.page === page}
            aria-label={`Page ${p.page}`}
            onClick={() => onChange({ page: p.page })}
            className={cx(
              "flex flex-col items-center gap-1 rounded-sm border p-1.5",
              focusRing,
              transition,
              p.page === page
                ? "border-accent bg-accent-soft"
                : "border-line bg-field hover:border-line-strong",
            )}
          >
            <img
              src={thumbUrl(p.page)}
              alt=""
              loading="lazy"
              className="h-24 w-full rounded-sm object-contain"
            />
            <span className="font-mono text-2xs tabular-nums text-muted">p. {p.page}</span>
          </button>
        ))}
      </div>
      {pageCount > pages.length && (
        <Field
          label="Page number"
          htmlFor="drawing-page"
          hint={`Thumbnails show the first ${pages.length} of ${pageCount} pages.`}
        >
          <Input
            id="drawing-page"
            type="number"
            min={1}
            max={pageCount}
            value={page}
            onChange={(e) => onChange({ page: Number(e.target.value) })}
            className="w-32 font-mono"
          />
        </Field>
      )}
      <Segmented
        label="Resolution"
        options={DPI_CHOICES.map((d) => ({
          value: String(d),
          label: `${d} dpi`,
        }))}
        value={String(dpi)}
        onChange={(v) => onChange({ dpi: Number(v) as DpiChoice })}
      />
      {size && (
        <p className="font-mono text-xs tabular-nums text-muted">
          {size.width} × {size.height} px
        </p>
      )}
      {fitted?.lowered && (
        <Alert tone="info">
          This page is large, so it renders at {fitted.renderDpi} dpi to stay under 20 000 px a side and 300
          MP.
        </Alert>
      )}
      {!current && (
        <p className="text-xs text-muted">If this page is very large, the import lowers its DPI to fit.</p>
      )}
    </div>
  );
}
