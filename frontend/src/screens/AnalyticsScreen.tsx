import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { fetchAreaAnalytics, fetchPhotoBatches, fetchTimeline } from "@/api/analytics";
import { fetchAllSources } from "@/api/sources";
import { AreaSection } from "@/analytics/AreaSection";
import { PhotoBatchSection } from "@/analytics/PhotoBatchSection";
import { SourceSection } from "@/analytics/SourceSection";
import { SurveysSection } from "@/analytics/SurveysSection";
import { useLoad } from "@/analytics/useLoad";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { Switch } from "@/ui";

/**
 * What the detections add up to: surveys over time, one source, site areas, and photo batches.
 * Every number is read from run rows; this screen never loads a detection.
 */
export function AnalyticsScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  // Anything that rewrites a run's counts: a run finishing, review in bulk, a recount.
  useOnJobsFinished("map_detect", reload);
  useOnJobsFinished("infer", reload);
  useOnJobsFinished("accept_above", reload);
  useOnJobsFinished("recount", reload);
  useOnJobsFinished("area_recount", reload);
  useOnJobsFinished("map_import", reload);
  useOnJobsFinished("import", reload);

  const timeline = useLoad(`${projectId}|${verifiedOnly}|${reloadKey}`, () =>
    fetchTimeline(api, projectId, verifiedOnly),
  );
  const sources = useLoad(`${projectId}|${reloadKey}`, () => fetchAllSources(api, projectId));
  const areas = useLoad(`${projectId}|${reloadKey}`, () => fetchAreaAnalytics(api, projectId));
  const photos = useLoad(`${projectId}|${reloadKey}`, () => fetchPhotoBatches(api, projectId));
  const classes = timeline.data?.classes ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Analytics</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Counts are shown as total (verified). Verified means a person accepted the detection or drew it.
          </p>
        </div>
        <Switch checked={verifiedOnly} onChange={setVerifiedOnly} label="Verified only" />
      </header>
      <div className="mt-8 flex flex-col gap-10">
        <SurveysSection timeline={timeline.data} error={timeline.error} verifiedOnly={verifiedOnly} />
        <SourceSection
          projectId={projectId}
          sources={sources.data}
          verifiedOnly={verifiedOnly}
          reloadKey={reloadKey}
        />
        <AreaSection
          projectId={projectId}
          areas={areas.data}
          error={areas.error}
          classes={classes}
          verifiedOnly={verifiedOnly}
        />
        <PhotoBatchSection
          data={photos.data}
          error={photos.error}
          classes={classes}
          verifiedOnly={verifiedOnly}
        />
      </div>
    </div>
  );
}
