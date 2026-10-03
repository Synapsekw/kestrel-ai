import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FindingsMap } from "@/assetmodels/findingsMap/FindingsMap";
import { MAP_DOTS_MAX, useAssetMapDots } from "@/assetmodels/findingsMap/useAssetMapDots";
import { useAssetModel } from "@/assetmodels/useAssetModels";
import { findingPath } from "@/findings/links";
import { countLabel } from "@/lib/countLabel";
import { cx, focusRing, GlassPanel, Skeleton } from "@/ui";
import { assetModelPath } from "./AssetStaticCard";
import { OutcomeBar, type PhotoReviewCounts } from "./OutcomeBar";

function Note({ children }: { children: ReactNode }) {
  return <div className="grid h-full place-items-center p-2 text-center text-sm text-muted">{children}</div>;
}

/** Spec §9 Overview: the asset findings map card, with the photo outcome bar under it. */
export function AssetMapCard({
  projectId,
  modelId,
  photoReview,
  className,
}: {
  projectId: string;
  modelId: string;
  photoReview: PhotoReviewCounts | null;
  className?: string;
}) {
  const navigate = useNavigate();
  const { model } = useAssetModel(projectId, modelId);
  const { dots, truncated, error } = useAssetMapDots(projectId, modelId);

  let body: ReactNode;
  if (model === null || (error && !dots)) body = <Note>Couldn&apos;t load the findings map.</Note>;
  else if (model === undefined || dots === null) body = <Skeleton className="h-full rounded-card" />;
  else if (!model.frame || !model.review)
    body = (
      <Note>
        <span className="flex flex-col items-center gap-2">
          Set the asset frame and review profile to see the findings map.
          <Link
            to={assetModelPath(projectId, modelId)}
            className={cx("rounded-sm text-xs text-accent-ink", focusRing)}
          >
            Open Asset models
          </Link>
        </span>
      </Note>
    );
  else
    body = (
      <FindingsMap
        review={model.review}
        frame={model.frame}
        dots={dots}
        onOpen={(id) => void navigate(findingPath(projectId, id))}
        className="h-full"
      />
    );

  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-label="Findings on the asset"
      className={cx("flex min-h-0 flex-col gap-2 px-4 py-3.5", className)}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs text-muted">Findings on the asset</h2>
        {dots && (
          <span className="font-mono text-2xs text-muted">
            {countLabel(dots.length, "finding", "findings")}
            {truncated && `, first ${MAP_DOTS_MAX.toLocaleString("en-US")} shown`}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1">{body}</div>
      {photoReview && <OutcomeBar projectId={projectId} counts={photoReview} />}
    </GlassPanel>
  );
}
