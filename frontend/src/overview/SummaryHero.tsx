import { Link } from "react-router-dom";
import { drawingThumbnailUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import type { OverviewHero, ProjectOverview } from "@/api/overview";
import { countLabel } from "@/lib/countLabel";
import { cx, focusRing, GlassPanel } from "@/ui";

type Counts = ProjectOverview["data"];

const KINDS: { key: keyof Counts; one: string; many: string; tab: string }[] = [
  { key: "images", one: "photo", many: "photos", tab: "images" },
  { key: "maps", one: "map", many: "maps", tab: "maps" },
  { key: "elevations", one: "elevation", many: "elevations", tab: "maps" },
  { key: "point_clouds", one: "point cloud", many: "point clouds", tab: "clouds" },
  { key: "drawings", one: "drawing", many: "drawings", tab: "maps" }, // drawings have no tab of their own; they overlay in Maps
];

/** The hero when there is no map, cloud or photo: a drawing, else what the project holds (spec 5.3). */
export function SummaryHero({
  projectId,
  hero,
  data,
  className,
}: {
  projectId: string;
  hero: OverviewHero | null;
  data: Counts;
  className?: string;
}) {
  const { baseUrl, token } = useBackend();
  if (hero?.kind === "drawing" && hero.id)
    return (
      <GlassPanel
        variant="pane"
        as="section"
        aria-label="Drawing"
        className={cx("min-h-0 overflow-hidden p-2", className)}
      >
        <img
          src={drawingThumbnailUrl(baseUrl, token, projectId, hero.id)}
          alt="Newest drawing"
          className="h-full w-full rounded-sm object-contain"
        />
      </GlassPanel>
    );
  const present = KINDS.filter((k) => data[k.key] > 0);
  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-label="Project data"
      className={cx("grid min-h-0 place-items-center p-6", className)}
    >
      <ul className="flex flex-col gap-2 text-base">
        {present.map((k) => (
          <li key={k.key}>
            <Link
              to={`/p/${projectId}/${k.tab}`}
              className={cx("rounded-sm text-ink hover:text-accent-ink", focusRing)}
            >
              {countLabel(data[k.key], k.one, k.many)}
            </Link>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
