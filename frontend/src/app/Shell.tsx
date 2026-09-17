import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { useJobsStore } from "@/store/jobs";

const ACTIVE_STATES = new Set(["queued", "running"]);

interface NavItem {
  label: string;
  to: string | null;
}

function navItems(projectId: string | undefined, imageId: string | undefined): NavItem[] {
  const p = projectId ? `/p/${projectId}` : null;
  return [
    { label: "Projects", to: "/" },
    { label: "Data", to: p && `${p}/data` },
    { label: "Editor", to: p && imageId ? `${p}/edit/${imageId}` : null },
    { label: "Review", to: p && `${p}/review` },
    { label: "Models", to: p && `${p}/models` },
    { label: "Train", to: p && `${p}/train` },
    { label: "Query", to: p && `${p}/query` },
    { label: "Settings", to: p && `${p}/settings` },
  ];
}

function useProjectName(projectId: string | undefined): string | null {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void api.GET("/api/v1/projects/{projectId}", { params: { path: { projectId } } }).then(({ data }) => {
      if (!cancelled && data) setLoaded({ id: projectId, name: data.name });
    });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return loaded && loaded.id === projectId ? loaded.name : null;
}

export function Shell() {
  const { projectId, imageId } = useParams();
  const projectName = useProjectName(projectId);
  const activeJobs = useJobsStore(
    (s) => Object.values(s.jobs).filter((j) => ACTIVE_STATES.has(j.state)).length,
  );

  return (
    <div className="flex h-full w-full bg-slate-900 text-slate-100">
      <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-slate-800 bg-slate-950 p-3">
        <span className="mb-3 px-2 text-sm font-semibold uppercase tracking-wide text-orange-400">
          Machinery
        </span>
        {navItems(projectId, imageId).map((item) =>
          item.to ? (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `rounded px-2 py-1.5 text-sm ${isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800"}`
              }
            >
              {item.label}
            </NavLink>
          ) : (
            <span
              key={item.label}
              aria-disabled="true"
              className="rounded px-2 py-1.5 text-sm text-slate-600"
            >
              {item.label}
            </span>
          ),
        )}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
          <span className="truncate text-sm text-slate-300">{projectName ?? "No project open"}</span>
          <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
            {activeJobs} active {activeJobs === 1 ? "job" : "jobs"}
          </span>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
