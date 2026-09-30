import { useEffect, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { useProject } from "@/api/project";
import { runAutoProbe } from "@/app/effects";
import { useDataLabels } from "@/findings/useDataLabels";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { useNow } from "@/jobs/useNow";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, GlassPanel, Skeleton, buttonClass, useSeverityScale } from "@/ui";
import { Banners } from "./Banners";
import { CloudPreview } from "./CloudPreview";
import { composeOverview, type OverviewFacts, type PaneId } from "./compose";
import { FirstData } from "./FirstData";
import { HeaderStrip } from "./HeaderStrip";
import { ImageMosaic } from "./ImageMosaic";
import { ImageryPane } from "./ImageryPane";
import { buildKpis, headerFigures, severityRows } from "./kpis";
import { MapHero } from "./MapHero";
import { RecentFindings } from "./RecentFindings";
import { SiteLocation } from "./SiteLocation";
import { StatusPane } from "./StatusPane";
import { SummaryHero } from "./SummaryHero";
import { useLatestImages } from "./useLatestImages";
import { useOverview } from "./useOverview";
import { useOverviewSite } from "./useOverviewSite";
import "./overview.css";

/** The loading state keeps the full layout's shape, so the page does not jump when it lands. */
const SKELETON = composeOverview({
  heroKind: "map",
  dataTotal: 1,
  hasCloud: true,
  hasImages: true,
  hasSite: true,
  findingsTotal: 1,
  runningJobs: false,
});

function OverviewSkeleton() {
  return (
    <div className="ov-grid w-full" aria-busy="true" style={{ "--ov-rows": SKELETON.rows } as CSSProperties}>
      {SKELETON.panes.map((p) => (
        <div key={p.id} data-pane={p.id} style={{ "--col": p.col, "--row": p.row } as CSSProperties}>
          <Skeleton className={`${p.id === "header" ? "h-14" : "h-full"} min-h-28 rounded-panel`} />
        </div>
      ))}
    </div>
  );
}

/** A project with photos but no findings yet: say so, and point at where detection starts. */
function NoFindingsYet({ projectId }: { projectId: string }) {
  return (
    <GlassPanel variant="pane" className="flex h-full items-center justify-between gap-3 px-4 py-3">
      <p className="text-sm text-muted">No findings yet.</p>
      <Link to={`/p/${projectId}/runs`} className={buttonClass("secondary", "sm")}>
        Run detection
      </Link>
    </GlassPanel>
  );
}

/**
 * The project's front page (F §9.1; spec 2026-09-30-project-landing §5): pre-aggregated counts only,
 * never a scan per render, laid out as a full-height grid composed from what the project holds.
 */
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
  const { site, settled: siteSettled } = useOverviewSite(projectId, Boolean(overview));
  const { images } = useLatestImages(projectId, Boolean(overview && overview.data.images > 0));
  // RunningJobs' notion of "running": any active (queued or running) job of this project.
  const runningJobs = useJobsStore((st) =>
    Object.values(st.jobs).some((j) => j.project_id === projectId && isActiveJob(j)),
  );
  // The same project read the top bar's breadcrumb takes the name from.
  const { project } = useProject(projectId);
  const projectName = project?.id === projectId ? project.name : null;

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
  const d = overview.data;
  const dataTotal = Object.values(d).reduce((a, b) => a + b, 0);
  const hero = overview.hero;
  const facts: OverviewFacts = {
    heroKind: hero?.kind ?? null,
    dataTotal,
    hasCloud: d.point_clouds > 0,
    hasImages: d.images > 0,
    // Until the site read lands, assume a located project will have a site, so the hero does not
    // narrow from 12 to 8 columns under the operator; the location pane shows a skeleton meanwhile.
    hasSite: siteSettled
      ? Boolean(site && (site.center || site.photo_points.length > 0))
      : d.maps + d.point_clouds + d.images > 0,
    findingsTotal: total,
    runningJobs,
  };
  const { panes, rows } = composeOverview(facts);
  // HeaderStrip relabels the `data` figure to "Images" itself.
  const figures = headerFigures(buildKpis(overview, scale, projectId, today));

  const render = (id: PaneId) => {
    switch (id) {
      case "firstData":
        return <FirstData projectId={projectId} />;
      case "header":
        return (
          <HeaderStrip
            projectId={projectId}
            name={projectName}
            figures={figures}
            site={siteSettled ? site : null}
          />
        );
      case "hero":
        if (hero?.kind === "map" && hero.id)
          return <MapHero projectId={projectId} heroMapId={hero.id} hasData />;
        if (hero?.kind === "point_cloud")
          return <CloudPreview projectId={projectId} cloudId={hero.id} variant="hero" className="h-full" />;
        if (hero?.kind === "images")
          return images ? (
            <ImageMosaic projectId={projectId} images={images} className="h-full" />
          ) : (
            <Skeleton className="h-full rounded-panel" />
          );
        return <SummaryHero projectId={projectId} hero={hero} data={d} className="h-full" />;
      case "cloud":
        return <CloudPreview projectId={projectId} cloudId={null} variant="tile" className="h-full" />;
      case "location":
        if (!siteSettled) return <Skeleton className="h-full rounded-panel" />;
        return site && <SiteLocation site={site} pins={recent} className="h-full" />;
      case "findings":
        return total > 0 ? (
          <RecentFindings
            projectId={projectId}
            findings={recent}
            failed={recentFailed}
            total={total}
            types={types}
            labels={labels}
            className="h-full"
          />
        ) : (
          <NoFindingsYet projectId={projectId} />
        );
      case "imagery":
        return images ? (
          <ImageryPane projectId={projectId} images={images} total={d.images} className="h-full" />
        ) : (
          <Skeleton className="h-full rounded-panel" />
        );
      case "status":
        return (
          <StatusPane
            projectId={projectId}
            rows={severityRows(s, scale, projectId)}
            activity={activity}
            activityFailed={activityFailed}
            showBars={total > 0}
            className="h-full"
          />
        );
    }
  };

  // Notices sit above the grid, not in it: an auto-placed grid child would land in a stray row.
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3.5">
      {refreshError && (
        <Alert
          tone="warn"
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
      <section
        aria-label="Overview"
        data-testid="overview-grid"
        className="ov-grid w-full"
        style={{ "--ov-rows": rows } as CSSProperties}
      >
        <h1 className="sr-only">Overview</h1>
        {panes.map((p) => (
          <div key={p.id} data-pane={p.id} style={{ "--col": p.col, "--row": p.row } as CSSProperties}>
            {render(p.id)}
          </div>
        ))}
      </section>
    </div>
  );
}
