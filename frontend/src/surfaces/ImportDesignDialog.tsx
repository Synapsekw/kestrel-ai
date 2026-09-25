import { useEffect, useState, type FormEvent } from "react";
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
import { messageOf } from "@/api/errors";
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
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"read" | "preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inspectJob = useTrackedJob(projectId, inspection?.state === "inspecting" ? inspection.job_id : null);
  const previewJob = useTrackedJob(projectId, preview?.state === "running" ? preview.job_id : null);
  const inspectDone = inspectJob.job !== null && !isActiveJob(inspectJob.job);
  const previewDone = previewJob.job !== null && !isActiveJob(previewJob.job);

  useEffect(() => {
    let cancelled = false;
    listTargetSurfaces(api, projectId)
      .then((t) => !cancelled && setTargets(t))
      .catch(() => !cancelled && setTargets([]));
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);

  useEffect(() => {
    if (!inspection || inspection.state !== "inspecting" || !inspectDone) return;
    let cancelled = false;
    getDesignInspection(api, projectId, inspection.id)
      .then((next) => {
        if (cancelled || next.state === "inspecting") return;
        setInspection(next);
        if (next.state === "ready") {
          const f = initialForm(next, targets);
          setForm(f);
          setName(defaultName(next, f));
        }
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

  const stale = form !== null && isStale(form, preview, previewedKey);
  const gate = importGate(preview, stale, accepted);

  function discard() {
    if (inspection) void deleteDesignInspection(api, projectId, inspection.id).catch(() => undefined);
  }

  function close() {
    if (busy === "import") return;
    discard();
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
    try {
      const r = await createDesignInspection(api, projectId, path.trim());
      useJobsStore.getState().upsert(r.job);
      setInspection(r.inspection);
    } catch (e) {
      setFileError(messageOf(e, "could not read the file"));
    } finally {
      setBusy(null);
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
    try {
      const res = await createDesignSurface(api, projectId, {
        inspection_id: inspection.id,
        preview_id: preview.id,
        accept_warnings: accepted,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      useJobsStore.getState().upsert(res.job);
      onStarted(res.surface);
    } catch (err) {
      setError(messageOf(err, "could not start the import"));
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
          {inspection?.state === "inspecting" && (
            <Progress
              value={inspectJob.job?.progress}
              running
              label={inspectJob.job?.message || "Reading design file"}
            />
          )}
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
            {preview.state === "running" && (
              <Progress
                value={previewJob.job?.progress}
                running
                label={previewJob.job?.message || "Previewing design"}
              />
            )}
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
                  <Input id="design-name" value={name} onChange={(e) => setName(e.target.value)} />
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
