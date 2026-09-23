import { useState } from "react";
import { Alert, EmptyState, SkeletonRows } from "@/ui";
import type { SurveyTimeline } from "@/api/surveys";
import { SurveyChart } from "@/surveys/SurveyChart";
import { SurveyTable } from "@/surveys/SurveyTable";
import { ClassLegend } from "./ClassLegend";
import { toggled } from "./format";
import { Section } from "./Section";

/** The survey timeline: one map is one survey, oldest to newest. */
export function SurveysSection({
  timeline,
  error,
  verifiedOnly,
}: {
  timeline: SurveyTimeline | null;
  error: string | null;
  verifiedOnly: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  return (
    <Section
      title="Surveys"
      testId="surveys-section"
      intro={
        verifiedOnly
          ? "Verified objects in each survey: accepted or drawn by a person. Each map is one survey."
          : "Objects in each survey, and what changed since the one before it. Each map is one survey."
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!timeline && !error && <SkeletonRows rows={3} columns={4} />}
      {timeline && timeline.surveys.length === 0 && (
        <EmptyState icon="map" title="No surveys yet">
          Add a map of the site and run a model over it. Each map counts as one survey.
        </EmptyState>
      )}
      {timeline && timeline.surveys.length > 1 && (
        <div className="mb-6">
          <SurveyChart timeline={timeline} hidden={hidden} />
          <ClassLegend
            classes={timeline.classes}
            hidden={hidden}
            onToggle={(id) => setHidden((h) => toggled(h, id))}
          />
        </div>
      )}
      {timeline && timeline.surveys.length > 0 && (
        <div data-testid="surveys-table" className="overflow-x-auto">
          <SurveyTable timeline={timeline} verified={verifiedOnly ? "only" : "both"} />
        </div>
      )}
    </Section>
  );
}
