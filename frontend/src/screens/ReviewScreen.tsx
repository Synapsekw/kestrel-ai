import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { REVIEW_QUEUE_QUERY } from "@/api/images";
import { useProjectKind, type ProjectKind } from "@/app/useProjectKind";
import { useImageList } from "@/data/useImageList";
import { DetectReview } from "@/review/DetectReview";
import { ImageReviewQueue } from "@/review/ImageReviewQueue";
import { EmptyState } from "@/ui";

const linkClass = "font-medium text-accent hover:underline";

/** Review: a detection project reviews one source's run at a time; otherwise the image queue. */
export function ReviewScreen() {
  const { projectId = "" } = useParams();
  const kind = useProjectKind(projectId);
  if (kind === "detect") return <DetectReview projectId={projectId} />;
  return <SuggestionReview projectId={projectId} kind={kind} />;
}

/** Spec section 6 screen 4: images with unreviewed suggestions sorted by suggestion confidence, same editor. */
function SuggestionReview({ projectId, kind }: { projectId: string; kind: ProjectKind | null }) {
  const [params] = useSearchParams();
  // `?ids=` narrows the queue to one query run's images (contract gap 2: `ids` overrides the filters).
  const runIds = params.get("ids");
  const query = useMemo(
    () => (runIds ? { ...REVIEW_QUEUE_QUERY, ids: runIds } : REVIEW_QUEUE_QUERY),
    [runIds],
  );
  const list = useImageList(projectId, query);

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Review</h1>
        <p className="text-sm text-muted">
          Suggestions from detection runs and pre-annotation wait here until you accept or reject them.
        </p>
        {runIds && (
          <p
            data-testid="run-filter"
            className="mt-1 text-sm text-ink animate-reveal motion-reduce:animate-none"
          >
            {list.loading
              ? "Loading the images of this detection run…"
              : `${list.total} of the ${runIds.split(",").length} images of this detection run still have suggestions to review.`}{" "}
            <Link to={`/p/${projectId}/review`} className={linkClass}>
              Show the whole queue
            </Link>
          </p>
        )}
      </div>

      <ImageReviewQueue
        projectId={projectId}
        list={list}
        empty={
          <EmptyState icon="review" title="Nothing to review">
            {kind === "train" ? (
              <>
                Suggestions appear here when the editor opens an image while a pre-annotation model is set in
                the{" "}
                <Link to={`/p/${projectId}/settings`} className={linkClass}>
                  Project settings
                </Link>
                .
              </>
            ) : (
              <>
                Suggestions appear here after a detection run on the{" "}
                <Link to={`/p/${projectId}/query`} className={linkClass}>
                  Detect screen
                </Link>
                , or when the editor opens an image while a pre-annotation model is set in the{" "}
                <Link to={`/p/${projectId}/settings`} className={linkClass}>
                  Project settings
                </Link>
                .
              </>
            )}
          </EmptyState>
        }
      />
    </section>
  );
}
