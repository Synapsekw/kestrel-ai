import { Navigate, useLocation, useParams } from "react-router-dom";
import { DetectReview } from "@/review/DetectReview";

/**
 * Ruling 5: the old review queue is the Images workspace filtered to suggestions; `?view=runs`
 * keeps the runs picker (M's map review lives behind it).
 */
export function ReviewRoute() {
  const { projectId = "" } = useParams();
  const { search, hash } = useLocation();
  const q = new URLSearchParams(search);
  if (q.get("view") === "runs") return <DetectReview projectId={projectId} />;
  q.delete("view");
  q.set("filter", "suggestions");
  return <Navigate to={`/p/${projectId}/images?${q.toString()}${hash}`} replace />;
}
