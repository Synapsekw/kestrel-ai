import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Project } from "@contract/client";
import { AgentDrawer } from "@/agent/AgentDrawer";
import { useAgentPanel } from "@/agent/panelStore";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { CatalogueSeverityProvider } from "@/catalogue/CatalogueSeverityProvider";
import { jobUrl } from "@/jobs/jobsFilters";
import { useInitialJobs } from "@/jobs/useJobList";
import { useChangesStore } from "@/store/changes";
import { Toaster, useJobToasts } from "@/ui";
import { AddDataHost } from "./AddDataHost";
import { PageTransition } from "./PageTransition";
import { Palette } from "./Palette";
import { routeInfo } from "./routeModel";
import { ShortcutSheet } from "./ShortcutSheet";
import { Sidebar } from "./Sidebar";
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
 * The app shell (spec 2026-09-26-foundation section 5.1): the sidebar, then a column of the top bar
 * and the page, entering through PageTransition.
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
  const navigate = useNavigate();
  // App-wide: library jobs and jobs of any project toast on every route; "Show log" opens the job.
  useJobToasts(pathnameRef, (job) => navigate(jobUrl(job)));
  useEffect(() => {
    useChangesStore.getState().setOpenProject(projectId ?? null);
  }, [projectId]);
  const bare = info.layout !== "page";

  return (
    <CatalogueSeverityProvider>
      <div className="grid h-full w-full grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] text-ink">
        <Sidebar projectId={projectId} projectName={project?.name ?? null} />
        <div className="relative flex min-h-0 min-w-0 flex-col">
          <TopBar projectId={projectId} onOpenPalette={() => setPaletteOpen(true)} />
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
    </CatalogueSeverityProvider>
  );
}
