import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { pushLog } from "@/app/diagnostics";
import { AgentDrawer } from "@/agent/AgentDrawer";
import { useAgentPanel } from "@/agent/panelStore";
import { Header } from "@/app/Header";
import { NextStepBar } from "@/app/NextStepBar";
import { Sidebar } from "@/app/Sidebar";
import { useProjectKindStore } from "@/app/useProjectKind";
import { useProjectProgress } from "@/app/useProjectProgress";
import { JobsPanel } from "@/jobs/JobsPanel";
import { useInitialJobs } from "@/jobs/useJobList";
import { Toaster, useJobToasts } from "@/ui";

function useProjectName(projectId: string | undefined): string | null {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void api
      .GET("/api/v1/projects/{projectId}", { params: { path: { projectId } } })
      .then(({ data }) => {
        if (cancelled || !data) return;
        setLoaded({ id: projectId, name: data.name });
        // The same answer carries the kind; the sidebar and the kind routes read it from the store.
        useProjectKindStore.getState().set(projectId, data.kind);
      })
      .catch((e: unknown) => {
        pushLog(`load project name failed: ${e}`);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return loaded && loaded.id === projectId ? loaded.name : null;
}

export function Shell() {
  const agent = useAgentPanel();
  const { projectId, imageId } = useParams();
  const { pathname } = useLocation();
  const projectName = useProjectName(projectId);
  useInitialJobs(projectId ?? "");
  useProjectProgress(projectId);
  // Read when a job ends: a toast is skipped on the screen that already reports that job.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  useJobToasts(projectId, pathnameRef);
  const isHome = !!projectId && pathname.replace(/\/$/, "") === `/p/${projectId}`;
  const editor = !!imageId;
  // Work surfaces fill the viewport themselves: no page padding, no scrolling shell, and no step
  // bar stealing height from the image or the map. Everything else is a padded, scrollable page.
  const workSurface = editor || /\/maps(\/|$)/.test(pathname);

  return (
    <div className="flex h-full w-full bg-ground text-ink">
      <Sidebar projectId={projectId} projectName={projectName} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Header projectId={projectId} projectName={projectName} />
        {projectId && !workSurface && !isHome && <NextStepBar projectId={projectId} />}
        <main
          className={
            workSurface ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto p-4 lg:p-6"
          }
        >
          <Outlet />
        </main>
        {projectId && <JobsPanel projectId={projectId} />}
        <AgentDrawer
          projectId={projectId}
          projectName={projectName}
          open={agent.open}
          onClose={() => agent.setOpen(false)}
        />
      </div>
      <Toaster />
    </div>
  );
}
