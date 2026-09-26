import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ClassDefInput, Project } from "@contract/client";
import { useAgentPanel } from "@/agent/panelStore";
import { useApi, useBackend } from "@/api/client";
import { messageOf, unwrap } from "@/api/errors";
import { legacyCreateBody, legacyKind } from "@/api/legacyKind";
import { pushLog } from "@/app/diagnostics";
import { useProjectKindStore, type ProjectKind } from "@/app/useProjectKind";
import {
  Alert,
  Button,
  Disclosure,
  EmptyState,
  Field,
  Input,
  Pill,
  Segmented,
  SkeletonRows,
  Textarea,
} from "@/ui";

type KindFilter = "all" | ProjectKind;

const KIND_PILL: Record<ProjectKind, string> = { train: "Training", detect: "Detection" };

const DEFAULT_CLASSES = [
  "excavator",
  "wheel_loader",
  "bulldozer",
  "dump_truck",
  "crane",
  "concrete_mixer",
  "roller",
  "backhoe",
];

const CLASS_COLOURS = [
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#ef4444",
];

function parseClasses(text: string): ClassDefInput[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name, i) => ({
      name,
      colour: CLASS_COLOURS[i % CLASS_COLOURS.length],
      hotkey: i < 9 ? String(i + 1) : null,
    }));
}

/** Folder input: a native directory picker inside Tauri, a plain text field in the browser. */
function FolderField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (folder: string) => void;
  hint?: string;
}) {
  const { mode } = useBackend();
  const pick = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true });
    if (typeof picked === "string") onChange(picked);
  }, [onChange]);

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="E:\Projects\Ahmadia"
          className="font-mono"
        />
        {mode === "tauri" && (
          <Button icon="folder" onClick={() => void pick()}>
            Browse
          </Button>
        )}
      </div>
    </Field>
  );
}

export function ProjectsScreen() {
  const api = useApi();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [classes, setClasses] = useState(DEFAULT_CLASSES.join("\n"));
  const [openFolder, setOpenFolder] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [kind, setKind] = useState<ProjectKind>("train");
  const [filter, setFilter] = useState<KindFilter>("all");
  const shown = useMemo(
    () => (projects ?? []).filter((p) => filter === "all" || legacyKind(p) === filter),
    [projects, filter],
  );
  const classNames = useMemo(() => parseClasses(classes).map((c) => c.name), [classes]);

  useEffect(() => {
    let cancelled = false;
    void api
      .GET("/api/v1/projects")
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (data) setProjects(data.items);
        else {
          setProjects([]);
          setError(messageOf(err, "could not list projects"));
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`list projects failed: ${e}`);
        setProjects([]);
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const openProject = useCallback(
    (project: Project) => {
      pushLog(`open project ${project.id}`);
      // The kind never changes: the shell and the kind routes need not load it again.
      useProjectKindStore.getState().set(project.id, legacyKind(project));
      void navigate(`/p/${project.id}`);
    },
    [navigate],
  );

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!folder.trim()) {
      setError("Choose a folder for the project.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await api.POST("/api/v1/projects", {
        // A detection project starts without classes: its first run fills them in.
        body: legacyCreateBody(name, folder, kind, kind === "train" ? parseClasses(classes) : []),
      });
      if (data) openProject(data);
      else setError(messageOf(err, "could not create the project"));
    } catch (e) {
      pushLog(`create project failed: ${e}`);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onForget(project: Project) {
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.DELETE("/api/v1/projects/{projectId}", { params: { path: { projectId: project.id } } }),
      );
      setProjects((list) => (list ?? []).filter((p) => p.id !== project.id));
      setRemoving(null);
    } catch (e) {
      pushLog(`forget project failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not remove the project from the list"));
    } finally {
      setBusy(false);
    }
  }

  async function onOpen(e: FormEvent) {
    e.preventDefault();
    if (!openFolder.trim()) {
      setError("Choose the project folder to open.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await api.POST("/api/v1/projects/open", {
        body: { folder: openFolder },
      });
      if (data) openProject(data);
      else setError(messageOf(err, "could not open the folder"));
    } catch (e) {
      pushLog(`open folder failed: ${e}`);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
        <p className="text-sm text-muted">
          A project is a folder on disk. A training project turns labeled images into a model for your
          library; a detection project runs models from the library over a site&apos;s images and maps.
        </p>
      </div>

      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_minmax(20rem,26rem)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="recent-projects" className="text-base font-semibold">
              Recent projects
            </h2>
            {projects && projects.length > 0 && (
              <Segmented
                label="Show projects"
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "train", label: "Training" },
                  { value: "detect", label: "Detection" },
                ]}
              />
            )}
          </div>
          {projects === null ? (
            <SkeletonRows rows={3} columns={2} />
          ) : projects.length === 0 ? (
            <EmptyState icon="folder" title="No projects yet">
              Create one on the right, or open a folder that already holds a project.
            </EmptyState>
          ) : shown.length === 0 ? (
            <p className="py-6 text-sm text-muted">
              No {filter === "detect" ? "detection" : "training"} projects in the list.
            </p>
          ) : (
            <ul aria-labelledby="recent-projects" className="flex flex-col gap-2">
              {shown.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 transition-[border-color,box-shadow] duration-140 ease-out hover:border-line-strong hover:shadow-sm motion-reduce:transition-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{p.name}</span>
                      <Pill size="sm" tone={legacyKind(p) === "detect" ? "accent" : "neutral"}>
                        {KIND_PILL[legacyKind(p)]}
                      </Pill>
                    </span>
                    <span className="block truncate font-mono text-xs text-muted">{p.folder}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${p.name} from the list`}
                      onClick={() => setRemoving(removing === p.id ? null : p.id)}
                    >
                      Remove
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => openProject(p)}>
                      Open
                    </Button>
                  </span>
                  {removing === p.id && (
                    <div className="basis-full">
                      <Alert
                        tone="warn"
                        role="status"
                        actions={
                          <>
                            <Button size="sm" onClick={() => void onForget(p)} disabled={busy}>
                              Remove from the list
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                              Keep
                            </Button>
                          </>
                        }
                      >
                        Remove {p.name} from this list? The folder and everything in it stay on disk; Open
                        folder brings the project back.
                      </Alert>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-10">
          <form onSubmit={(e) => void onCreate(e)} className="flex flex-col gap-4" noValidate>
            <h2 className="text-base font-semibold">Create a project</h2>
            <div className="flex flex-col gap-2">
              <Segmented
                label="Kind of project"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "train", label: "Training project", icon: "train" },
                  { value: "detect", label: "Detection project", icon: "detect" },
                ]}
                className="self-start"
              />
              <p className="text-[13px] leading-relaxed text-muted">
                {kind === "train"
                  ? "Label images, build datasets and train a model. Every model you train goes into your library."
                  : "Run a model from your library over a site's images and maps, and review what it finds. The class list comes from the first model you run."}
              </p>
            </div>
            {kind === "train" && (
              <Button onClick={() => useAgentPanel.getState().setOpen(true)} className="self-start">
                Plan with the setup agent
              </Button>
            )}
            <Field label="Name" htmlFor="project-name">
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Site name or campaign"
              />
            </Field>
            <FolderField
              id="project-folder"
              label="Folder"
              value={folder}
              onChange={setFolder}
              hint="A new or empty folder. Imported images are copied here; the originals are never touched."
            />
            {kind === "train" ? (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] font-medium">Classes</p>
                <div className="flex flex-wrap gap-1.5">
                  {classNames.length === 0 ? (
                    <span className="text-xs text-danger">Add at least one class.</span>
                  ) : (
                    classNames.map((c) => <Pill key={c}>{c}</Pill>)
                  )}
                </div>
                <Disclosure label="Edit the class list">
                  <Field
                    label="Classes (one per line)"
                    htmlFor="project-classes"
                    hint="Each class gets a colour and a number key in the editor. Classes can be changed later in Project settings."
                  >
                    <Textarea
                      id="project-classes"
                      value={classes}
                      onChange={(e) => setClasses(e.target.value)}
                      rows={8}
                      className="font-mono"
                    />
                  </Field>
                </Disclosure>
              </div>
            ) : null}
            <Button type="submit" variant="primary" loading={busy} icon="plus" className="self-start">
              Create project
            </Button>
          </form>

          <form onSubmit={(e) => void onOpen(e)} className="flex flex-col gap-4" noValidate>
            <h2 className="text-base font-semibold">Open a project folder</h2>
            <FolderField id="open-folder" label="Folder" value={openFolder} onChange={setOpenFolder} />
            <Button type="submit" loading={busy} icon="folder" className="self-start">
              Open folder
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
