import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Project } from "@contract/client";
import { FolderField } from "@/agent/FolderField";
import { createDetectionProject, fetchDetectionProjects, moveMap } from "@/api/adoption";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJob } from "@/api/jobs";
import { legacyKind } from "@/api/legacyKind";
import { pushLog } from "@/app/diagnostics";
import { useProjectKindStore } from "@/app/useProjectKind";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Progress, Select, buttonClass } from "@/ui";

const NEW = "new";
/** How often the target project's move job is read while it runs. */
const POLL_MS = 1000;

type Target = Pick<Project, "id" | "name">;

/**
 * Copies a past map out of a training project into a detection project, an existing one or a new
 * one made here. The copy is a `map_move` job in the target project; its progress shows inline.
 */
export function MoveMapDialog({
  projectId,
  geoMap,
  onClose,
}: {
  projectId: string;
  geoMap: { id: string; name: string };
  onClose: () => void;
}) {
  const api = useApi();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [choice, setChoice] = useState<string>(NEW);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A project made by this dialog: pinned, so a retry never creates another. */
  const [created, setCreated] = useState<Target | null>(null);
  /** Where the current move job copies to. */
  const [target, setTarget] = useState<Target | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobsStore((s) => (jobId ? s.jobs[jobId] : undefined));

  useEffect(() => {
    let cancelled = false;
    fetchDetectionProjects(api)
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        if (list.length) setChoice(list[0].id);
      })
      .catch((e: unknown) => {
        pushLog(`list detection projects failed: ${messageOf(e, String(e))}`);
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const running = jobId !== null && (!job || isActiveJob(job));
  useEffect(() => {
    if (!target || !jobId || !running) return;
    let cancelled = false;
    const poll = () =>
      fetchJob(api, target.id, jobId)
        .then((j) => {
          if (!cancelled) useJobsStore.getState().upsert(j);
        })
        .catch((e: unknown) => pushLog(`move job poll failed: ${messageOf(e, String(e))}`));
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, target, jobId, running]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (running) return;
    const creating = choice === NEW;
    if (creating && !created && (!name.trim() || !folder.trim())) {
      setError("Name the new detection project and choose its folder.");
      return;
    }
    setBusy(true);
    setError(null);
    setJobId(null);
    try {
      let to: Target | undefined = created ?? undefined;
      if (!to) {
        if (creating) {
          const made = await createDetectionProject(api, name.trim(), folder.trim());
          useProjectKindStore.getState().set(made.id, legacyKind(made));
          // Keep a project created here even if the move below fails: a retry must not create another.
          setCreated(made);
          to = made;
        } else {
          to = projects?.find((p) => p.id === choice);
        }
        if (!to) return;
      }
      setTarget(to);
      const started = await moveMap(api, projectId, geoMap.id, to.id);
      useJobsStore.getState().upsert(started);
      setJobId(started.id);
    } catch (err) {
      pushLog(`move map failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not start moving the map"));
    } finally {
      setBusy(false);
    }
  }

  const done = job?.state === "succeeded";
  const failed = job && !isActiveJob(job) && !done;
  const locked = busy || running || done || created !== null;

  return (
    <Dialog
      open
      title={`Move ${geoMap.name} to a detection project`}
      description="The map, its capture date, zones and labels are copied. Its runs stay here; run it again there with a model from your library."
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        done && target ? (
          <>
            <Button onClick={onClose}>Close</Button>
            <Link
              to={`/p/${target.id}/maps/${geoMap.id}`}
              className={buttonClass("primary", "md")}
              onClick={onClose}
            >
              Open {target.name}
            </Link>
          </>
        ) : running ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon="arrow-right" loading={busy}>
              {failed ? "Try again" : "Move map"}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Detection project" htmlFor="move-map-target">
          <Select
            id="move-map-target"
            value={created?.id ?? choice}
            disabled={projects === null || locked}
            onChange={(e) => {
              setChoice(e.target.value);
              setError(null);
              setJobId(null);
              setTarget(null);
            }}
          >
            {projects === null ? (
              <option value={NEW}>Loading projects…</option>
            ) : (
              <>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {created && !projects.some((p) => p.id === created.id) && (
                  <option value={created.id}>{created.name}</option>
                )}
                <option value={NEW}>New detection project…</option>
              </>
            )}
          </Select>
        </Field>

        {choice === NEW && projects !== null && !created && (
          <div className="flex flex-col gap-4">
            <Field label="Name" htmlFor="move-map-name">
              <Input
                id="move-map-name"
                value={name}
                disabled={locked}
                onChange={(e) => setName(e.target.value)}
                placeholder="North site"
              />
            </Field>
            <FolderField label="Folder" value={folder} onChange={setFolder} disabled={locked} />
          </div>
        )}

        {jobId && running && (
          <div className="flex flex-col gap-1.5" role="status">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">Copying the map to {target?.name}</span>
              <span className="truncate text-xs text-muted">{job?.message}</span>
            </div>
            <Progress value={job?.progress} running label="Moving the map" />
            <p className="text-xs text-muted">You can close this; the copy carries on in the background.</p>
          </div>
        )}
        {done && target && (
          <Alert tone="ok">
            {geoMap.name} is now in {target.name}. It stays here too, read-only.
          </Alert>
        )}
        {failed && (
          <Alert tone="danger" title="The map was not moved">
            {job?.error ?? "The copy stopped before it finished."}
          </Alert>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
