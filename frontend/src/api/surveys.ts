import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

export type SurveyTimeline = components["schemas"]["SurveyTimeline"];
export type Survey = components["schemas"]["Survey"];
export type SurveyBasis = { model_id?: string; conf?: number };

export function fetchSurveyTimeline(
  api: ApiClient,
  projectId: string,
  basis?: SurveyBasis,
): Promise<SurveyTimeline> {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/survey-timeline", {
      params: { path: { projectId }, query: basis ?? {} },
    }),
  );
}
