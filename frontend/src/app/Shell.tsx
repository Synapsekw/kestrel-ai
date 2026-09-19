import { useEffect, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { pushLog } from "@/app/diagnostics";
import { Header } from "@/app/Header";
import { NextStepBar } from "@/app/NextStepBar";
import { Sidebar } from "@/app/Sidebar";
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
        if (!cancelled && data) setLoaded({ id: projectId, name: data.name });
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
  const { projectId, imageId } = useParams();
  const { pathname } = useLocation();
  const projectName = useProjectName(projectId);
  useInitialJobs(projectId ?? "");
  useProjectProgress(projectId);
  useJobToasts(projectId);
  const isHome = !!projectId && pathname.replace(/\/$/, "") === `/p/${projectId}`;
  const editor = !!imageId;

  return (
    <div className="flex h-full w-full bg-ground text-ink">
      <Sidebar projectId={projectId} projectName={projectName} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Header projectId={projectId} projectName={projectName} />
        {projectId && !editor && !isHome && <NextStepBar projectId={projectId} />}
        <main className={editor ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto p-6"}>
          <Outlet />
        </main>
        {projectId && <JobsPanel projectId={projectId} />}
      </div>
      <Toaster />
    </div>
  );
}
