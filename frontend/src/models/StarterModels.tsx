import { useEffect, useId, useRef, useState } from "react";
import type { Job, Model, StarterModel } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelJob, fetchJob } from "@/api/jobs";
import { fetchModel } from "@/api/models";
import { acquireStarterModel, listStarterModels } from "@/api/starterModels";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Field, Pill, Progress, Select } from "@/ui";

interface Props {
  projectId: string;
  existingNames: string[];
  onImported: (model: Model) => void;
}

export function StarterModels({ projectId, existingNames, onImported }: Props) {
  const api = useApi();
  const id = useId();
  const [starters, setStarters] = useState<StarterModel[]>([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imported = useRef(onImported);
  useEffect(() => {
    imported.current = onImported;
  }, [onImported]);

  useEffect(() => {
    let cancelled = false;
    listStarterModels(api)
      .then((items) => {
        if (!cancelled) {
          setStarters(items);
          setKey(items[0]?.key ?? "");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(messageOf(e, "Could not load starter models."));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(current: Job) {
      if (cancelled) return;
      try {
        const next = await fetchJob(api, projectId, current.id);
        if (!cancelled) {
          setError(null);
          await check(next);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`${messageOf(e, "Could not check progress.")} Reconnecting to this download...`);
          timer = setTimeout(() => void poll(current), 1000);
        }
      }
    }
    async function check(current: Job) {
      if (cancelled) return;
      useJobsStore.getState().upsert(current);
      setJob(current);
      try {
        if (current.state === "succeeded") {
          const modelId = current.result?.model_id;
          if (typeof modelId !== "string") throw new Error("The import did not return a model.");
          const model = await fetchModel(api, projectId, modelId);
          if (!cancelled) {
            imported.current(model);
            setBusy(false);
            setJob(null);
          }
        } else if (current.state === "failed" || current.state === "cancelled") {
          setError(current.error ?? "Model download cancelled.");
          setBusy(false);
          setJob(null);
        } else {
          timer = setTimeout(() => void poll(current), 1000);
        }
      } catch (e) {
        if (!cancelled) {
          setError(messageOf(e, "Could not add the model."));
          setBusy(false);
          setJob(null);
        }
      }
    }
    void check(job);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Progress updates keep the same polling session until the job identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectId, job?.id]);

  async function add() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      setJob(await acquireStarterModel(api, projectId, selected.key));
    } catch (e) {
      setError(messageOf(e, "Could not start the model download."));
      setBusy(false);
    }
  }

  const familyOf = (s: StarterModel) => s.family ?? s.name.split(" ")[0];
  const selected = starters.find((s) => s.key === key) ?? starters[0];
  const family = selected ? familyOf(selected) : "";
  const families = [...new Set(starters.map(familyOf))];
  if (starters.length === 0 && !error) return null;

  return (
    <section className="flex max-w-3xl flex-col gap-3">
      <h2 className="text-base font-semibold">Starter models</h2>
      <p className="max-w-prose text-sm leading-relaxed text-muted">
        Choose a YOLO family and size for object detection. Only the model you add is downloaded. Train it on
        your labeled machinery images before relying on aerial counts. Segmentation, pose and rotated-box
        models are not supported in this workflow.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {selected && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Model family" htmlFor={`${id}-family`}>
              <Select
                id={`${id}-family`}
                value={family}
                disabled={busy}
                onChange={(e) => setKey(starters.find((s) => familyOf(s) === e.target.value)?.key ?? "")}
              >
                {families.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Starter model" htmlFor={`${id}-model`}>
              <Select
                id={`${id}-model`}
                value={selected.key}
                disabled={busy}
                onChange={(e) => setKey(e.target.value)}
              >
                {starters
                  .filter((s) => familyOf(s) === family)
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <p className="text-sm text-muted">{selected.description}</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs tabular-nums text-muted">
              {selected.available
                ? `${selected.size_mb} MB · Ready on this computer`
                : "Internet required for the first download"}
            </span>
            {existingNames.includes(`${selected.key}-coco`) && (
              <Pill tone="neutral" size="sm">
                In the registry
              </Pill>
            )}
          </div>
          {job && (
            <>
              <Progress value={job.progress} running label="Model download" />
              <p role="status" className="text-sm text-muted">
                {job.message || "Preparing model…"}
              </p>
            </>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              icon="plus"
              loading={busy}
              disabled={busy}
              aria-label={
                busy ? undefined : `${selected.available ? "Add" : "Download and add"} ${selected.name}`
              }
              onClick={() => void add()}
            >
              {busy ? "Adding…" : selected.available ? "Add" : "Download and add"}
            </Button>
            {job && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void cancelJob(api, projectId, job.id).catch((e: unknown) =>
                    setError(messageOf(e, "Could not cancel download.")),
                  );
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
