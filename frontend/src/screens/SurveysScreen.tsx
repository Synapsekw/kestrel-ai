import { useParams } from "react-router-dom";
import { Alert, EmptyState, SkeletonRows } from "@/ui";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useSurveyTimeline } from "@/surveys/useSurveyTimeline";
import { SurveyTable } from "@/surveys/SurveyTable";

/** Counts over time: one row per survey, and what changed since the one before it. */
export function SurveysScreen() {
  const { projectId = "" } = useParams();
  const { timeline, loading, error, reload } = useSurveyTimeline(projectId);
  useOnJobsFinished("map_detect", reload);
  useOnJobsFinished("map_import", reload);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-xl font-semibold text-ink">Surveys</h1>
      <p className="mt-1 text-sm text-muted">
        How many objects each survey found, and what changed since the one before it. Each map is one survey.
      </p>
      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      {loading && !timeline && (
        <div className="mt-6">
          <SkeletonRows rows={3} columns={4} />
        </div>
      )}
      {timeline && timeline.surveys.length === 0 && (
        <EmptyState icon="map" title="No surveys yet" className="mt-6">
          Import a map of the site and run a model over it. Each map counts as one survey.
        </EmptyState>
      )}
      {timeline && timeline.surveys.length > 0 && (
        <div className="mt-6">
          <SurveyTable timeline={timeline} />
        </div>
      )}
    </div>
  );
}
