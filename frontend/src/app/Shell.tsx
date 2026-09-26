import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import type { Project } from "@contract/client";
import { AgentDrawer } from "@/agent/AgentDrawer";
import { useAgentPanel } from "@/agent/panelStore";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { JobsPanel } from "@/jobs/JobsPanel";
import { useInitialJobs } from "@/jobs/useJobList";
import { useChangesStore } from "@/store/changes";
import { Toaster, useJobToasts } from "@/ui";
import { AddDataHost } from "./AddDataHost";
import { PageTransition } from "./PageTransition";
import { Palette } from "./Palette";
import { ProjectTabs } from "./ProjectTabs";
import { Rail } from "./Rail";
import { routeInfo } from "./routeModel";
import { ShortcutSheet } from "./ShortcutSheet";
import { TopBar } from "./TopBar";
import { usePaletteShortcut } from "./usePaletteShortcut";

/** The open project, or null while loading and when it cannot be loaded (the chrome still renders). */
function useShellProject(projectId: string | undefined): Project | null {
  const api = useApi();
  const [loaded, setLoaded] = useState<Project | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchProject(api, projectId)
      .then((p) => {
        if (!cancelled) setLoaded(p);
      })
      .catch((e: unknown) => pushLog(`load project failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return loaded && loaded.id === projectId ? loaded : null;
}

/**
 * The app shell (spec 2026-09-26-foundation section 5.1): the rail, then a column of the top bar,
 * the project tabs (not on full-bleed surfaces) and the page, entering through PageTransition.
 * It paints no background of its own: the chrome and the page sit on the body's fixed backdrop.
 */
export function Shell() {
  const agent = useAgentPanel();
  const { projectId } = useParams();
  const { pathname } = useLocation();
  const info = routeInfo(pathname);
  const project = useShellProject(projectId);
  const [paletteOpen, setPaletteOpen] = usePaletteShortcut();
  useInitialJobs(projectId ?? "");
  // Read when a job ends: a toast is skipped on the screen that already reports that job.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  useJobToasts(projectId, pathnameRef);
  useEffect(() => {
    useChangesStore.getState().setOpenProject(projectId ?? null);
  }, [projectId]);
  const bare = info.layout !== "page";

  return (
    <div className="grid h-full w-full grid-cols-[64px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] text-ink">
      <Rail projectId={projectId} />
      <div className="relative flex min-h-0 min-w-0 flex-col">
        <TopBar
          projectId={projectId}
          projectName={project?.name ?? null}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        {projectId && info.layout !== "fullbleed" && <ProjectTabs projectId={projectId} />}
        <main
          className={
            bare
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "flex min-h-0 flex-1 flex-col overflow-auto px-5 py-4 lg:px-6 lg:py-5"
          }
        >
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
        {/* Kept until the Jobs section replaces it: toasts' "Show log" and re-imports open it. */}
        {projectId && <JobsPanel projectId={projectId} />}
        <AgentDrawer
          projectId={projectId}
          projectName={project?.name ?? null}
          open={agent.open}
          onClose={() => agent.setOpen(false)}
        />
        <AddDataHost project={project} />
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} project={project} />
      <ShortcutSheet />
      <Toaster />
    </div>
  );
}
