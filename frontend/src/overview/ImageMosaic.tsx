import { Link } from "react-router-dom";
import { thumbnailUrl, type Image as ImageRow } from "@contract/client";
import { useBackend } from "@/api/client";
import { cx, focusRing, GlassPanel } from "@/ui";

/**
 * Grid shape by frame count, so no cell is left blank: cols, rows, and the rows the first frame spans.
 * 1: one frame; 2: side by side; 3-4: one large and the rest stacked; 5: one large and four small.
 */
const LAYOUT: Record<number, { cols: number; rows: number; span: number; className: string }> = {
  1: { cols: 1, rows: 1, span: 1, className: "grid-cols-1 grid-rows-1" },
  2: { cols: 2, rows: 1, span: 1, className: "grid-cols-2 grid-rows-1" },
  3: { cols: 2, rows: 2, span: 2, className: "grid-cols-[2fr_1fr] grid-rows-2" },
  4: { cols: 2, rows: 3, span: 3, className: "grid-cols-[2fr_1fr] grid-rows-3" },
  5: { cols: 3, rows: 2, span: 2, className: "grid-cols-[2fr_1fr_1fr] grid-rows-2" },
};
const SPAN: Record<number, string> = { 1: "", 2: "row-span-2", 3: "row-span-3" };

/** The hero when there is no map or point cloud: one large frame and up to four small (spec 5.3). */
export function ImageMosaic({
  projectId,
  images,
  className,
}: {
  projectId: string;
  images: ImageRow[];
  className?: string;
}) {
  const { baseUrl, token } = useBackend();
  const shown = images.slice(0, 5);
  const layout = LAYOUT[Math.max(1, shown.length)];
  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-label="Latest photos"
      className={cx("min-h-0 overflow-hidden p-1.5", className)}
    >
      <div
        data-testid="mosaic-grid"
        data-cols={layout.cols}
        data-rows={layout.rows}
        className={cx("grid h-full gap-1.5", layout.className)}
      >
        {shown.map((img, i) => (
          <Link
            key={img.id}
            aria-label={`Open photo ${img.file_name}`}
            to={`/p/${projectId}/images/${img.id}`}
            data-span={i === 0 ? layout.span : 1}
            className={cx(
              "relative overflow-hidden rounded-sm bg-surface-2",
              i === 0 && SPAN[layout.span],
              focusRing,
            )}
          >
            <img
              src={thumbnailUrl(baseUrl, token, projectId, img.id)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          </Link>
        ))}
      </div>
    </GlassPanel>
  );
}
