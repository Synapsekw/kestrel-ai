import { useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isActiveJob, selectActiveCount, useJobsStore } from "@/store/jobs";
import { isForcedCollapse, routeInfo, secondaryOf, sidebarCollapsed, type RouteInfo } from "./routeModel";
import { useSidebar } from "./sidebarStore";
import { SidebarProjectTree } from "./SidebarProjectTree";
import { SidebarView } from "./SidebarView";
import { useProjectCounts } from "./useProjectCounts";
import { useSidebarShortcut } from "./useSidebarShortcut";
import { useWindowWidth } from "./useWindowWidth";

/** Loads what the tree shows; mounted only inside a project, so the overview is read once per project. */
function ProjectTree({
  projectId,
  projectName,
  info,
  pathname,
  collapsed,
}: {
  projectId: string;
  projectName: string | null;
  info: RouteInfo;
  pathname: string;
  collapsed: boolean;
}) {
  const counts = useProjectCounts(projectId);
  const busy = useJobsStore((s) =>
    Object.values(s.jobs).some((j) => j.project_id === projectId && isActiveJob(j)),
  );
  return (
    <SidebarProjectTree
      projectId={projectId}
      projectName={projectName}
      busy={busy}
      counts={counts}
      tab={info.tab}
      secondary={secondaryOf(pathname)}
      collapsed={collapsed}
    />
  );
}

/** The app's navigation (spec 2026-10-03-sidebar): the view wired to the route, jobs and collapse state. */
export function Sidebar({
  projectId,
  projectName,
}: {
  projectId: string | undefined;
  projectName: string | null;
}) {
  const { pathname } = useLocation();
  const info = routeInfo(pathname);
  const forced = isForcedCollapse(info.layout, useWindowWidth());
  const stored = useSidebar((s) => s.stored);
  const override = useSidebar((s) => s.override);
  // Derived at render so the choice ends on the very frame the page changes (spec §4).
  const here = override?.key === info.transitionKey ? override.collapsed : null;
  const collapsed = sidebarCollapsed(stored, forced, here);
  const activeJobs = useJobsStore(selectActiveCount);

  // Housekeeping only: drops a stale choice so returning to the page starts fresh.
  useEffect(() => useSidebar.getState().clearOverride(), [info.transitionKey]);

  const toggle = useCallback(
    () => useSidebar.getState().toggle(forced, info.transitionKey),
    [forced, info.transitionKey],
  );
  useSidebarShortcut(toggle);

  return (
    <SidebarView
      section={info.section}
      projectId={projectId}
      collapsed={collapsed}
      activeJobs={activeJobs}
      onToggle={toggle}
      tree={
        projectId ? (
          <ProjectTree
            projectId={projectId}
            projectName={projectName}
            info={info}
            pathname={pathname}
            collapsed={collapsed}
          />
        ) : undefined
      }
    />
  );
}
