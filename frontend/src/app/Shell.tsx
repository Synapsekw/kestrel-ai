import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { pushLog } from "@/app/diagnostics";
import { JobsButton } from "@/jobs/JobsButton";
import { JobsPanel } from "@/jobs/JobsPanel";
import { useInitialJobs } from "@/jobs/useJobList";

interface NavItem {
  label: string;
  to: string | null;
  /** Why the entry is disabled; shown as its tooltip. */
  hint?: string;
}

const NO_PROJECT_HINT = "Open or create a project first";

/** Entries that only exist inside a project; without one they render disabled with a reason. */
function projectNavItems(projectId: string | undefined, imageId: string | undefined): NavItem[] {
  const p = projectId ? `/p/${projectId}` : null;
  const item = (label: string, path: string): NavItem => ({
    label,
    to: p && `${p}/${path}`,
    hint: NO_PROJECT_HINT,
  });
  return [
    item("Data", "data"),
    {
      label: "Editor",
      to: p && imageId ? `${p}/edit/${imageId}` : null,
      hint: p ? "Open an image from Data or Review" : NO_PROJECT_HINT,
    },
    item("Review", "review"),
    item("Models", "models"),
    item("Train", "train"),
    item("Query", "query"),
    item("Settings", "settings"),
  ];
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1.5 text-sm ${isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800"}`;

function NavEntry({ item }: { item: NavItem }) {
  return item.to ? (
    <NavLink to={item.to} end={item.to === "/"} className={linkClass}>
      {item.label}
    </NavLink>
  ) : (
    <span
      aria-disabled="true"
      title={item.hint}
      className="cursor-not-allowed rounded px-2 py-1.5 text-sm text-slate-600"
    >
      {item.label}
    </span>
  );
}

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
  const projectName = useProjectName(projectId);
  useInitialJobs(projectId ?? "");

  return (
    <div className="flex h-full w-full bg-slate-900 text-slate-100">
      <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-slate-800 bg-slate-950 p-3">
        <span className="mb-3 px-2 text-sm font-semibold uppercase tracking-wide text-orange-400">
          Machinery
        </span>
        <NavEntry item={{ label: "Projects", to: "/" }} />
        <span className="mt-3 px-2 text-xs uppercase tracking-wide text-slate-500">Project</span>
        {!projectId && (
          <p className="px-2 pb-1 text-xs text-slate-400">Open or create a project to use these.</p>
        )}
        {projectNavItems(projectId, imageId).map((item) => (
          <NavEntry key={item.label} item={item} />
        ))}
        <div className="mt-auto flex flex-col gap-1 border-t border-slate-800 pt-2">
          <NavEntry item={{ label: "App settings", to: "/settings" }} />
        </div>
      </nav>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
          <span className="truncate text-sm text-slate-300">{projectName ?? "No project open"}</span>
          <JobsButton />
        </header>
        <main className={imageId ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto p-6"}>
          <Outlet />
        </main>
        {projectId && <JobsPanel projectId={projectId} />}
      </div>
    </div>
  );
}
