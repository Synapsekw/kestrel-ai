import { Link } from "react-router-dom";
import { thumbnailUrl, type Image as ImageRow } from "@contract/client";
import { useBackend } from "@/api/client";
import { cx, focusRing, GlassPanel, transition } from "@/ui";

export function ImageryPane({
  projectId,
  images,
  total,
  className,
}: {
  projectId: string;
  images: ImageRow[];
  total: number;
  className?: string;
}) {
  const { baseUrl, token } = useBackend();
  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-labelledby="overview-imagery"
      className={cx("flex min-h-0 flex-col p-3", className)}
    >
      <div className="flex items-center justify-between">
        <h2 id="overview-imagery" className="text-xs text-muted">
          Latest imagery <span className="font-mono text-dim">{total.toLocaleString("en-US")}</span>
        </h2>
        <Link
          to={`/p/${projectId}/images`}
          className={cx("rounded-sm text-xs text-muted hover:text-ink", transition, focusRing)}
        >
          View all
        </Link>
      </div>
      <div className="mt-2 grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-1.5">
        {images.slice(0, 8).map((img) => (
          <img
            key={img.id}
            src={thumbnailUrl(baseUrl, token, projectId, img.id)}
            alt=""
            className="h-full w-full rounded-sm bg-surface-2 object-cover"
          />
        ))}
      </div>
    </GlassPanel>
  );
}
