import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { runAutoProbe } from "@/app/effects";
import { useDataLabels } from "@/findings/useDataLabels";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { useNow } from "@/jobs/useNow";
import { Alert, Button, Skeleton, buttonClass, useSeverityScale } from "@/ui";
import { ActivityFeed } from "./ActivityFeed";
import { Banners } from "./Banners";
import { KpiRow } from "./KpiRow";
import { buildKpis, severityRows } from "./kpis";
import { MapHero } from "./MapHero";
import { RecentFindings } from "./RecentFindings";
import { RunningJobs } from "./RunningJobs";
import { SeverityBars } from "./SeverityBars";
import { useOverview } from "./useOverview";
import "./overview.css";

const GRID = "mx-auto grid w-full max-w-[1400px] grid-cols-12 gap-3.5";

function OverviewSkeleton() {
  return (
    <div className={GRID} aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="col-span-12 h-28 rounded-panel sm:col-span-6 xl:col-span-3" />
      ))}
      <Skeleton className="col-span-12 h-[360px] rounded-panel lg:col-span-8" />
      <Skeleton className="col-span-12 h-[360px] rounded-panel lg:col-span-4" />
    </div>
  );
}

/** The project's front page (F §9.1): pre-aggregated counts only, never a scan per render. */
export function OverviewScreen() {
  const { projectId = "" } = useParams();
  const {
    overview,
    recent,
    activity,
    recentFailed,
    activityFailed,
    error,
    refreshError,
    code,
    loading,
    reload,
  } = useOverview(projectId);
  const scale = useSeverityScale();
  const { types } = useProjectTypes(projectId);
  const labels = useDataLabels(projectId);
  // F22: the day comes from `useNow`, never a `new Date()` of the render's own.
  const today = new Date(useNow(60_000)).toISOString().slice(0, 10);

  useEffect(() => {
    // F §4.3: the reduced-effects Auto probe measures frames on the first Overview render.
    void runAutoProbe();
  }, []);

  if (code === "project_upgrading")
    return (
      <Alert
        tone="info"
        actions={
          <Link to="/projects" className={buttonClass("secondary", "sm")}>
            Projects
          </Link>
        }
      >
        This project is being upgraded to the new format. It opens when the upgrade finishes; the Projects
        page shows its progress.
      </Alert>
    );
  if (error)
    return (
      <Alert
        tone="danger"
        title="Couldn't load the overview"
        actions={
          <Button size="sm" icon="refresh" onClick={reload}>
            Retry
          </Button>
        }
      >
        {error}
      </Alert>
    );
  if (loading || !overview) return <OverviewSkeleton />;

  const s = overview.findings;
  const total = s.by_status.open + s.by_status.reviewed + s.by_status.closed;
  const hasData = Object.values(overview.data).some((n) => n > 0);
  return (
    <section aria-label="Overview" className={GRID}>
      <h1 className="sr-only">Overview</h1>
      {refreshError && (
        <Alert
          tone="warn"
          className="col-span-12"
          title="Couldn't refresh the overview"
          actions={
            <Button size="sm" icon="refresh" onClick={reload}>
              Retry
            </Button>
          }
        >
          Showing the last numbers read. {refreshError}
        </Alert>
      )}
      <Banners projectId={projectId} banners={overview.banners} />
      <KpiRow kpis={buildKpis(overview, scale, projectId, today)} />
      <MapHero projectId={projectId} heroMapId={overview.hero_map_id} hasData={hasData} />
      <div className="col-span-12 flex flex-col gap-3.5 lg:col-span-4">
        <SeverityBars rows={severityRows(s, scale, projectId)} />
        <RunningJobs projectId={projectId} />
      </div>
      <RecentFindings
        projectId={projectId}
        findings={recent}
        failed={recentFailed}
        total={total}
        types={types}
        labels={labels}
      />
      <ActivityFeed projectId={projectId} items={activity} failed={activityFailed} />
    </section>
  );
}
