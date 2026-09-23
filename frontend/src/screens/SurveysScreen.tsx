import { useState } from "react";
import { useParams } from "react-router-dom";
import { Alert, EmptyState, SkeletonRows } from "@/ui";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useSurveyTimeline } from "@/surveys/useSurveyTimeline";
import { SurveyTable } from "@/surveys/SurveyTable";
import { SurveyChart } from "@/surveys/SurveyChart";

/** Counts over time: one row per survey, and what changed since the one before it. */
export function SurveysScreen() {
  const { projectId = "" } = useParams();
  const { timeline, loading, error, reload } = useSurveyTimeline(projectId);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (classId: string) =>
    setHidden((was) => {
      const next = new Set(was);
      if (!next.delete(classId)) next.add(classId);
      return next;
    });
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
      {timeline && timeline.surveys.length > 1 && (
        <div className="mt-6">
          <SurveyChart timeline={timeline} hidden={hidden} />
          <div className="mt-2 flex flex-wrap gap-3">
            {timeline.classes.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                aria-pressed={!hidden.has(c.id)}
                className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: hidden.has(c.id) ? "transparent" : c.colour,
                    boxShadow: `inset 0 0 0 2px ${c.colour}`,
                  }}
                />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {timeline && timeline.surveys.length > 0 && (
        <div className="mt-6">
          <SurveyTable timeline={timeline} />
        </div>
      )}
    </div>
  );
}
