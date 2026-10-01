import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Project } from "@contract/client";
import { useAgentPanel } from "@/agent/panelStore";
import { useApi } from "@/api/client";
import { messageOf, unwrap } from "@/api/errors";
import { fetchJob } from "@/api/jobs";
import { retryMigration } from "@/api/migrations";
import { pushLog } from "@/app/diagnostics";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, EmptyState, Input, Select, Skeleton, stagger, toast } from "@/ui";
import { OpenFolderDialog } from "./projects/OpenFolderDialog";
import { ProjectCard } from "./projects/ProjectCard";
import { visibleProjects, type ProjectSort } from "./projects/projectCards";

const GRID = "grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3";

/** F §9.2: a card grid of the recent projects (≤ 20, pre-aggregated summaries), with search and sort. */
export function ProjectsScreen() {
  const api = useApi();
  const navigate = useNavigate();
  const revision = useChangesStore((s) => s.projectsRevision);
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState<{ items: Project[]; error: string | null } | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<ProjectSort>("recent");
  const [removing, setRemoving] = useState<Project | null>(null);
  const [dialog, setDialog] = useState<"open" | null>(null);
  const [locating, setLocating] = useState<Project | null>(null);
  // Folders whose retry request is in flight: a double click sends one POST, not two.
  const retrying = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useOnJobsFinished("project_migrate", reload);

  useEffect(() => {
    let cancelled = false;
    api
      .GET("/api/v1/projects")
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoaded(
          data
            ? { items: data.items, error: null }
            : { items: [], error: messageOf(error, "could not list the projects") },
        );
      })
      .catch((e: unknown) => {
        pushLog(`list projects failed: ${e}`);
        if (!cancelled) setLoaded({ items: [], error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [api, revision, tick]);

  const items = useMemo(() => loaded?.items ?? [], [loaded]);

  // Seed running upgrade jobs (library runner) so their progress shows and their finish is seen.
  useEffect(() => {
    for (const p of items) {
      const id = p.migration.state === "running" ? p.migration.job_id : null;
      if (id && !useJobsStore.getState().jobs[id])
        fetchJob(api, "library", id)
          .then((job) => useJobsStore.getState().upsert(job))
          .catch((e: unknown) => pushLog(`migration job ${id} unavailable: ${messageOf(e, String(e))}`));
    }
  }, [api, items]);

  const shown = useMemo(() => visibleProjects(items, q, sort), [items, q, sort]);

  const openProject = useCallback(
    (p: Project) => {
      pushLog(`open project ${p.id}`);
      void navigate(`/p/${p.id}/overview`);
    },
    [navigate],
  );

  async function retry(p: Project) {
    if (retrying.current.has(p.folder)) return;
    retrying.current.add(p.folder);
    try {
      await retryMigration(api, p.folder);
      toast("info", `Upgrading ${p.name} again`);
      reload();
    } catch (e) {
      toast("danger", messageOf(e, "could not start the upgrade"));
    } finally {
      retrying.current.delete(p.folder);
    }
  }

  async function forget(p: Project) {
    setBusy(true);
    try {
      await unwrap(api.DELETE("/api/v1/projects/{projectId}", { params: { path: { projectId: p.id } } }));
      setLoaded((s) => (s ? { ...s, items: s.items.filter((x) => x.id !== p.id) } : s));
      setRemoving(null);
    } catch (e) {
      pushLog(`forget project failed: ${messageOf(e, String(e))}`);
      toast("danger", messageOf(e, "could not remove the project from the list"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Projects" className="mx-auto flex max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="max-w-prose text-sm text-muted">
            A project is a folder on disk. It holds the photos, maps, elevation models and point clouds of a
            site, and the findings recorded on them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => useAgentPanel.getState().setOpen(true)}>
            Plan with the setup agent
          </Button>
          <Button icon="folder" onClick={() => setDialog("open")}>
            Open folder
          </Button>
          <Button variant="primary" icon="plus" onClick={() => void navigate("/projects/new")}>
            New project
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64">
          <Input
            type="search"
            aria-label="Search projects"
            placeholder="Search by name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          aria-label="Sort projects"
          value={sort}
          onChange={(e) => setSort(e.target.value as ProjectSort)}
          wrapperClassName="w-48"
        >
          <option value="recent">Last opened</option>
          <option value="name">Name</option>
          <option value="findings">Open findings</option>
        </Select>
      </div>

      {loaded?.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={reload}>
              Retry
            </Button>
          }
        >
          {loaded.error}
        </Alert>
      )}

      {!loaded ? (
        <div className={GRID}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-panel" />
          ))}
        </div>
      ) : loaded.error ? null : items.length === 0 ? (
        <EmptyState icon="folder" title="No projects yet">
          Create one with New project, or open a folder that already holds a project.
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="py-6 text-sm text-muted">No project is called “{q.trim()}”.</p>
      ) : (
        <ul className={GRID}>
          {shown.map((p, i) => (
            <li key={p.id} className="stagger animate-rise" style={stagger(i)}>
              <ProjectCard
                project={p}
                onOpen={openProject}
                onRetry={(x) => void retry(x)}
                onRemove={setRemoving}
                onLocate={setLocating}
              />
            </li>
          ))}
        </ul>
      )}
      {dialog === "open" && <OpenFolderDialog onClose={() => setDialog(null)} onOpened={openProject} />}
      {locating && (
        <OpenFolderDialog
          title={`Locate ${locating.name}`}
          submitLabel="Use this folder"
          onClose={() => setLocating(null)}
          onOpened={(opened) => {
            setLocating(null);
            // Same project id: the backend replaced the stale entry. A different project: drop the stale one.
            if (opened.id !== locating.id) void forget(locating);
            reload();
            openProject(opened);
          }}
        />
      )}
      <Dialog
        open={removing !== null}
        title={removing ? `Remove ${removing.name} from the list?` : ""}
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Keep
            </Button>
            <Button loading={busy} onClick={() => removing && void forget(removing)}>
              Remove from the list
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          The folder and everything in it stay on disk; Open folder brings the project back.
        </p>
      </Dialog>
    </section>
  );
}
