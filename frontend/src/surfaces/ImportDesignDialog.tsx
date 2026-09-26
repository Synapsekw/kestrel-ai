import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApi, useBackend } from "@/api/client";
import {
  createDesignInspection,
  createDesignPreview,
  createDesignSurface,
  deleteDesignInspection,
  designPreviewImageUrl,
  designThumbnailUrl,
  getDesignInspection,
  getDesignPreview,
  listTargetSurfaces,
  type DesignInspection,
  type DesignPreview,
  type Surface,
} from "@/api/designSurfaces";
import { codeOf, messageOf } from "@/api/errors";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Pill, Progress } from "@/ui";
import { DesignCheck } from "./DesignCheck";
import { DesignContents } from "./DesignContents";
import { DesignPlacement } from "./DesignPlacement";
import {
  applyPatch,
  defaultName,
  importGate,
  initialForm,
  isStale,
  toRequest,
  type ImportForm,
} from "./designImport";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

export function ImportDesignDialog({
  projectId,
  onClose,
  onStarted,
}: {
  projectId: string;
  onClose: () => void;
  onStarted: (surface: Surface) => void;
}) {
  const api = useApi();
  const { mode, baseUrl, token } = useBackend();
  const [path, setPath] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<DesignInspection | null>(null);
  const [targets, setTargets] = useState<Surface[]>([]);
  const [form, setForm] = useState<ImportForm | null>(null);
  const [preview, setPreview] = useState<DesignPreview | null>(null);
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  // The name follows the selection (`defaultName`) until the user types one: a stale default would
  // save the surface under the wrong name.
  const [editedName, setEditedName] = useState<string | null>(null);
  const [targetsVersion, setTargetsVersion] = useState(0);
  const [busy, setBusy] = useState<"read" | "preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inspectJob = useTrackedJob(projectId, inspection?.state === "inspecting" ? inspection.job_id : null);
  const previewJob = useTrackedJob(projectId, preview?.state === "running" ? preview.job_id : null);
  const inspectDone = inspectJob.job !== null && !isActiveJob(inspectJob.job);
  const previewDone = previewJob.job !== null && !isActiveJob(previewJob.job);

  // Closing (or unmounting) while an inspection is being created or is unfinished must not leak it
  // on the backend, but once an import has actually started (or is in flight — the createDesignSurface
  // POST hasn't resolved yet, so a race could otherwise still delete out from under it) the inspection
  // is no longer ours to discard (Task 6 review (a), (b); controller follow-up review). `inspectionRef`
  // tracks the latest known inspection id even before `setInspection` has committed (the create POST
  // may still be in flight); `closedRef` and `startedRef` record why a later continuation should, or
  // should not, delete it. `startedRef` is "pending" for the duration of the createDesignSurface POST
  // (skip the delete either way), "started" once it succeeds, and reset to "idle" if it fails (a later
  // close should still discard the inspection).
  const inspectionRef = useRef<DesignInspection | null>(null);
  const closedRef = useRef(false);
  const startedRef = useRef<"idle" | "pending" | "started">("idle");
  useEffect(() => {
    inspectionRef.current = inspection;
  }, [inspection]);
  useEffect(() => {
    // StrictMode's dev-only mount→cleanup→mount rehearsal must not leave the dialog permanently
    // "closed": re-arm on every (re)mount, not just once.
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      if (startedRef.current === "idle" && inspectionRef.current) {
        const id = inspectionRef.current.id;
        inspectionRef.current = null;
        void deleteDesignInspection(api, projectId, id).catch(() => undefined);
      }
    };
  }, [api, projectId]);

  useEffect(() => {
    let cancelled = false;
    listTargetSurfaces(api, projectId)
      .then((t) => !cancelled && setTargets(t))
      .catch(() => !cancelled && setTargets([]));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, targetsVersion]);

  useEffect(() => {
    if (!inspection || inspection.state !== "inspecting" || !inspectDone) return;
    let cancelled = false;
    getDesignInspection(api, projectId, inspection.id)
      .then((next) => {
        if (cancelled || next.state === "inspecting") return;
        setInspection(next);
        if (next.state === "ready") setForm(initialForm(next, targets));
      })
      .catch((e: unknown) => !cancelled && setFileError(messageOf(e, "could not load the file's contents")));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, inspection, inspectDone, targets]);

  useEffect(() => {
    if (!inspection || !preview || preview.state !== "running" || !previewDone) return;
    let cancelled = false;
    getDesignPreview(api, projectId, inspection.id, preview.id)
      .then((next) => {
        if (!cancelled && next.state !== "running") setPreview(next);
      })
      .catch((e: unknown) => !cancelled && setError(messageOf(e, "could not load the preview")));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, inspection, preview, previewDone]);

  const name = editedName ?? (inspection && form ? defaultName(inspection, form) : "");
  const stale = form !== null && isStale(form, preview, previewedKey);
  const gate = importGate(preview, stale, accepted);

  function discard() {
    const insp = inspectionRef.current;
    if (!insp) return;
    inspectionRef.current = null;
    void deleteDesignInspection(api, projectId, insp.id).catch(() => undefined);
  }

  function close() {
    if (busy === "import") return;
    closedRef.current = true;
    if (startedRef.current === "idle") discard();
    onClose();
  }

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [{ name: "Design surface", extensions: ["dxf", "xml", "landxml", "tif", "tiff"] }],
    });
    if (typeof picked === "string") setPath(picked);
  }

  async function readFile() {
    if (!path.trim()) return setFileError("Choose the design file.");
    setBusy("read");
    setFileError(null);
    setError(null);
    discard();
    setInspection(null);
    setForm(null);
    setPreview(null);
    setEditedName(null);
    try {
      const r = await createDesignInspection(api, projectId, path.trim());
      useJobsStore.getState().upsert(r.job);
      if (closedRef.current) {
        // The dialog closed (or unmounted) while the create request was in flight: nothing is
        // listening any more, so delete the inspection it just created instead of leaking it.
        void deleteDesignInspection(api, projectId, r.inspection.id).catch(() => undefined);
        return;
      }
      inspectionRef.current = r.inspection;
      setInspection(r.inspection);
    } catch (e) {
      if (!closedRef.current) setFileError(messageOf(e, "could not read the file"));
    } finally {
      if (!closedRef.current) setBusy(null);
    }
  }

  async function runPreview(next: ImportForm) {
    if (!inspection) return;
    const r = toRequest(next);
    if (!r.ok) return setError(r.error);
    setBusy("preview");
    setError(null);
    try {
      const res = await createDesignPreview(api, projectId, inspection.id, r.body);
      useJobsStore.getState().upsert(res.job);
      setPreview(res.preview);
      setPreviewedKey(JSON.stringify(r.body));
      setAccepted(false);
    } catch (e) {
      setError(messageOf(e, "could not start the preview"));
    } finally {
      setBusy(null);
    }
  }

  function applySuggestion(patch: Record<string, unknown>) {
    if (!form) return;
    const next = applyPatch(form, patch);
    setForm(next);
    void runPreview(next);
  }

  async function importSurface(e: FormEvent) {
    e.preventDefault();
    if (!inspection || !preview || !gate.allowed) return;
    setBusy("import");
    setError(null);
    // Mark the import as in flight before awaiting the POST: an unmount that races it (e.g.
    // navigating away) must not delete the inspection out from under a request that may still
    // succeed.
    startedRef.current = "pending";
    try {
      const res = await createDesignSurface(api, projectId, {
        inspection_id: inspection.id,
        preview_id: preview.id,
        accept_warnings: accepted,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      useJobsStore.getState().upsert(res.job);
      startedRef.current = "started";
      onStarted(res.surface);
    } catch (err) {
      // The import never started: a later close should still discard the inspection.
      startedRef.current = "idle";
      setError(messageOf(err, "could not start the import"));
      const code = codeOf(err);
      if (code === "not_ready" || code === "conflict" || code === "job_running") {
        // The target (or the preview) changed under us, or this design is already being imported:
        // drop the preview so Preview is offered again, and reload the targets so a vanished one is
        // no longer listed.
        setPreview(null);
        setPreviewedKey(null);
        setAccepted(false);
        setTargetsVersion((v) => v + 1);
      }
    } finally {
      setBusy(null);
    }
  }

  const ready = inspection?.state === "ready" && form !== null;
  return (
    <Dialog
      open
      width="lg"
      title="Import design surface"
      description="A DEM GeoTIFF, a LandXML TIN or a DXF with 3D faces or contours. The file is only read; nothing is imported until you check the preview."
      onClose={close}
      onSubmit={(e) => void importSurface(e)}
      footer={
        <>
          <Button onClick={close} disabled={busy === "import"}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="import"
            loading={busy === "import"}
            disabled={!gate.allowed}
          >
            Import surface
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Section title="File">
          <Field
            label="Design file"
            htmlFor="design-path"
            error={fileError}
            hint="DXF, LandXML (.xml) or GeoTIFF."
          >
            <div className="flex gap-2">
              <Input
                id="design-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="D:\designs\site.xml"
                className="min-w-0 flex-1 font-mono"
              />
              {mode === "tauri" && <Button onClick={() => void browse()}>Browse</Button>}
              <Button onClick={() => void readFile()} loading={busy === "read"}>
                Read file
              </Button>
            </div>
          </Field>
          {inspection?.state === "inspecting" &&
            (inspectJob.error ? (
              <Alert
                tone="danger"
                actions={
                  <Button size="sm" icon="refresh" onClick={inspectJob.retry}>
                    Retry
                  </Button>
                }
              >
                {inspectJob.error}
              </Alert>
            ) : (
              <Progress
                value={inspectJob.job?.progress}
                running
                label={inspectJob.job?.message || "Reading design file"}
              />
            ))}
          {inspection?.state === "failed" && <Alert tone="danger">{inspection.error}</Alert>}
        </Section>

        {ready && inspection && form && (
          <>
            <Section title="Contents">
              <DesignContents
                inspection={inspection}
                selected={form.candidateIds}
                onChange={(ids) => setForm({ ...form, candidateIds: ids })}
                thumbUrl={(cid) => designThumbnailUrl(baseUrl, token, projectId, inspection.id, cid)}
              />
            </Section>
            <Section title="Placement">
              <DesignPlacement inspection={inspection} form={form} targets={targets} onChange={setForm} />
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => void runPreview(form)}
                  loading={busy === "preview"}
                  disabled={
                    preview?.state === "running" || (preview !== null && !stale && preview.state !== "failed")
                  }
                >
                  Preview
                </Button>
                {stale && <Pill tone="warn">Preview out of date</Pill>}
              </div>
              {error && <Alert tone="danger">{error}</Alert>}
            </Section>
          </>
        )}

        {preview && inspection && (
          <Section title="Check">
            {preview.state === "running" &&
              (previewJob.error ? (
                <Alert
                  tone="danger"
                  actions={
                    <Button size="sm" icon="refresh" onClick={previewJob.retry}>
                      Retry
                    </Button>
                  }
                >
                  {previewJob.error}
                </Alert>
              ) : (
                <Progress
                  value={previewJob.job?.progress}
                  running
                  label={previewJob.job?.message || "Previewing design"}
                />
              ))}
            {preview.state === "failed" && <Alert tone="danger">{preview.error}</Alert>}
            {preview.state === "ready" && (
              <>
                <DesignCheck
                  preview={preview}
                  imageUrl={designPreviewImageUrl(baseUrl, token, projectId, inspection.id, preview.id)}
                  accepted={accepted}
                  onAccept={setAccepted}
                  onApply={applySuggestion}
                  busy={busy !== null}
                />
                <Field label="Name" htmlFor="design-name">
                  <Input id="design-name" value={name} onChange={(e) => setEditedName(e.target.value)} />
                </Field>
              </>
            )}
            {gate.reason && preview.state === "ready" && <p className="text-sm text-muted">{gate.reason}</p>}
          </Section>
        )}
      </div>
    </Dialog>
  );
}
