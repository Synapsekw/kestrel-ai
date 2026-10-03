import type { DrawingPage } from "@/api/drawings";
import { Alert, Button, Field, Input, Segmented, cx, focusRing, transition } from "@/ui";
import { DPI_CHOICES, fitDpi, renderSize, type DpiChoice } from "./drawingImport";

/** Spec §8.2: pick pages (thumbnails for the first 50) and a DPI, lowered to fit the caps. */
export function PdfPagePicker({
  pages,
  pageCount,
  page,
  selected,
  dpi,
  onChange,
  thumbUrl,
}: {
  pages: readonly DrawingPage[];
  pageCount: number;
  page: number;
  selected: readonly number[];
  dpi: DpiChoice;
  onChange: (patch: { page?: number; pages?: number[]; dpi?: DpiChoice }) => void;
  thumbUrl: (page: number) => string;
}) {
  const multi = pageCount > 1;
  const current = pages.find((p) => p.page === page);
  const fitted = current ? fitDpi(current, dpi) : null;
  const size = current && fitted ? renderSize(current, fitted.renderDpi) : null;
  const chosen = (n: number) => (multi ? selected.includes(n) : n === page);

  function toggle(n: number) {
    if (!multi) {
      onChange({ page: n, pages: [n] });
      return;
    }
    const pagesNext = selected.includes(n)
      ? selected.filter((p) => p !== n)
      : [...selected, n].sort((a, b) => a - b);
    onChange({ page: n, pages: pagesNext });
  }

  return (
    <div className="flex flex-col gap-3">
      {multi && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ page: 1, pages: Array.from({ length: pageCount }, (_, i) => i + 1) })}
          >
            All pages
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange({ pages: [] })}>
            None
          </Button>
        </div>
      )}
      <div
        role={multi ? "group" : "radiogroup"}
        aria-label={multi ? "Pages" : "Page"}
        className="grid grid-cols-4 gap-2 sm:grid-cols-6"
      >
        {pages.map((p) => (
          <button
            key={p.page}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={chosen(p.page)}
            aria-label={`Page ${p.page}`}
            onClick={() => toggle(p.page)}
            className={cx(
              "flex flex-col items-center gap-1 rounded-sm border p-1.5",
              focusRing,
              transition,
              chosen(p.page)
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
      {multi && (
        <p className="text-xs text-muted">
          {selected.length === 0
            ? "Choose at least one page."
            : `${selected.length} of ${pageCount} pages selected. Each page becomes its own drawing.`}
        </p>
      )}
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
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isInteger(n) || n < 1 || n > pageCount) {
                onChange({ page: n });
                return;
              }
              onChange({
                page: n,
                pages: selected.includes(n) ? [...selected] : [...selected, n].sort((a, b) => a - b),
              });
            }}
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
