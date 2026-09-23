import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { fetchSurveyTimeline, type SurveyBasis, type SurveyTimeline } from "@/api/surveys";

type State = { key: string; timeline: SurveyTimeline | null; error: string | null };

/** The project's surveys. `reload()` bumps an attempt counter, as the other list hooks do. */
export function useSurveyTimeline(projectId: string, basis?: SurveyBasis) {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${basis?.model_id ?? ""}|${basis?.conf ?? ""}|${attempt}`;
  const [state, setState] = useState<State>({ key: "", timeline: null, error: null });
  useEffect(() => {
    let cancelled = false;
    fetchSurveyTimeline(api, projectId, basis)
      .then((timeline) => {
        if (!cancelled) setState({ key, timeline, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({ key, timeline: null, error: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => {
      cancelled = true;
    };
    // `key` carries projectId and the basis; a stale response for an old key is ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { timeline: state.timeline, loading: state.key !== key, error: state.error, reload };
}
