import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ClassDefInput, Project } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { pushLog } from "@/app/diagnostics";

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

/** The contract wraps failures as `{error: {code, message, details}}`. */
function messageOf(err: { error: { message: string } } | undefined, fallback: string): string {
  return err?.error.message ?? fallback;
}

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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (folder: string) => void;
}) {
  const { mode } = useBackend();
  const pick = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true });
    if (typeof picked === "string") onChange(picked);
  }, [onChange]);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-slate-300">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="E:\Projects\Ahmadia"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
        />
        {mode === "tauri" && (
          <button
            type="button"
            onClick={() => void pick()}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
          >
            Browse
          </button>
        )}
      </div>
    </div>
  );
}

export function ProjectsScreen() {
  const api = useApi();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [classes, setClasses] = useState(DEFAULT_CLASSES.join("\n"));
  const [openFolder, setOpenFolder] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api.GET("/api/v1/projects").then(({ data, error: err }) => {
      if (cancelled) return;
      if (data) setProjects(data.items);
      else setError(messageOf(err, "could not list projects"));
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const openProject = useCallback(
    (project: Project) => {
      pushLog(`open project ${project.id}`);
      void navigate(`/p/${project.id}/data`);
    },
    [navigate],
  );

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await api.POST("/api/v1/projects", {
      body: { name, folder, classes: parseClasses(classes) },
    });
    setBusy(false);
    if (data) openProject(data);
    else setError(messageOf(err, "could not create the project"));
  }

  async function onOpen(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await api.POST("/api/v1/projects/open", {
      body: { folder: openFolder },
    });
    setBusy(false);
    if (data) openProject(data);
    else setError(messageOf(err, "could not open the folder"));
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Projects</h1>

      {error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Recent</h2>
        {projects.length === 0 ? (
          <p className="text-sm text-slate-400">No projects yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded border border-slate-800 bg-slate-800/40 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate font-mono text-xs text-slate-400">{p.folder}</span>
                </span>
                <button
                  type="button"
                  onClick={() => openProject(p)}
                  className="rounded bg-orange-600 px-3 py-1.5 text-sm font-medium hover:bg-orange-500"
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={(e) => void onCreate(e)} className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Create project</h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="project-name" className="text-sm text-slate-300">
            Name
          </label>
          <input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm"
          />
        </div>
        <FolderField id="project-folder" label="Folder" value={folder} onChange={setFolder} />
        <div className="flex flex-col gap-1">
          <label htmlFor="project-classes" className="text-sm text-slate-300">
            Classes (one per line)
          </label>
          <textarea
            id="project-classes"
            value={classes}
            onChange={(e) => setClasses(e.target.value)}
            rows={8}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 font-mono text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded bg-orange-600 px-4 py-2 text-sm font-medium hover:bg-orange-500 disabled:opacity-50"
        >
          Create project
        </button>
      </form>

      <form onSubmit={(e) => void onOpen(e)} className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Open folder</h2>
        <FolderField id="open-folder" label="Folder" value={openFolder} onChange={setOpenFolder} />
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded border border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          Open folder
        </button>
      </form>
    </section>
  );
}
