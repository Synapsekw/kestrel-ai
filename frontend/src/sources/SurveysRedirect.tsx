import { Navigate, useParams } from "react-router-dom";

/** `/p/:id/surveys` is kept for old links and bookmarks: the survey timeline is part of Analytics now. */
export function SurveysRedirect() {
  const { projectId = "" } = useParams();
  return <Navigate to={`/p/${projectId}/analytics`} replace />;
}
