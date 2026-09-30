import { Link } from "react-router-dom";
import { thumbnailUrl, type Image as ImageRow } from "@contract/client";
import { useBackend } from "@/api/client";
import { cx, focusRing, GlassPanel } from "@/ui";

/** The hero when there is no map or point cloud: one large frame and four small (spec 5.3). */
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
  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-label="Latest photos"
      className={cx("min-h-0 overflow-hidden p-1.5", className)}
    >
      <div className="grid h-full grid-cols-[2fr_1fr_1fr] grid-rows-2 gap-1.5">
        {shown.map((img, i) => (
          <Link
            key={img.id}
            to={`/p/${projectId}/images/${img.id}`}
            className={cx(
              "relative overflow-hidden rounded-sm bg-surface-2",
              i === 0 && "row-span-2",
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
