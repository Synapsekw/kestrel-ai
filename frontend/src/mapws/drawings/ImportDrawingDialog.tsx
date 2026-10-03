import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useApi, useBackend } from "@/api/client";
import {
  createDrawing,
  createDrawingPages,
  createDrawingInspection,
  getDrawingInspection,
  pageThumbUrl,
  type Drawing,
  type DrawingInspection,
} from "@/api/drawings";
import { messageOf } from "@/api/errors";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Progress } from "@/ui";
import { DrawingLayerPicker } from "./DrawingLayerPicker";
import { DrawingPlacementFields } from "./DrawingPlacementFields";
import {
  drawingNameField,
  familyOf,
  initialDrawingForm,
  toDrawingPagesRequest,
  toDrawingRequest,
  type DrawingForm,
} from "./drawingImport";
import { takeImportPrefill } from "./importPrefill";
import { PdfPagePicker } from "./PdfPagePicker";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Add data → Drawing (spec §8.2): inspect the file (a job, followed here), choose the page or the
 * layers and the placement, then queue the build job and close. The file is never copied or changed.
 */
export function ImportDrawingDialog({
  projectId,
  onClose,
  onStarted,
}: {
  projectId: string;
  onClose: () => void;
  onStarted: (drawing: Drawing) => void;
}) {
  const api = useApi();
  const { mode, baseUrl, token } = useBackend();
  const [path, setPath] = useState(() => takeImportPrefill() ?? "");
  const [fileError, setFileError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<DrawingInspection | null>(null);
  const [form, setForm] = useState<DrawingForm | null>(null);
  const [busy, setBusy] = useState<"read" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const inspectJob = useTrackedJob(projectId, inspection?.state === "inspecting" ? inspection.job_id : null);
  const inspectDone = inspectJob.job !== null && !isActiveJob(inspectJob.job);

  useEffect(() => {
    if (!inspection || inspection.state !== "inspecting" || !inspectDone) return;
    let cancelled = false;
    getDrawingInspection(api, projectId, inspection.id)
      .then((next) => {
        if (cancelled || next.state === "inspecting") return;
        setInspection(next);
        if (next.state === "ready") setForm(initialDrawingForm(next));
      })
      .catch((e: unknown) => !cancelled && setFileError(messageOf(e, "could not load the file's contents")));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, inspection, inspectDone]);

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [
        {
          name: "Drawing",
          extensions: ["dxf", "xml", "landxml", "pdf", "png", "jpg", "jpeg", "tif", "tiff"],
        },
      ],
    });
    if (typeof picked === "string") setPath(picked);
  }

  async function readFile() {
    if (!path.trim()) return setFileError("Choose the drawing file.");
    setBusy("read");
    setFileError(null);
    setError(null);
    setInspection(null);
    setForm(null);
    try {
      const r = await createDrawingInspection(api, projectId, path.trim());
      useJobsStore.getState().upsert(r.job);
      setInspection(r.inspection);
      if (r.inspection.state === "ready") setForm(initialDrawingForm(r.inspection));
    } catch (e) {
      setFileError(messageOf(e, "could not read the file"));
    } finally {
      setBusy(null);
    }
  }

  async function startImport() {
    if (inFlight.current || !inspection || inspection.state !== "ready" || !form) return;
    const pages = [...new Set(form.pages)].sort((a, b) => a - b);
    const pdf = familyOf(inspection.format) === "pdf";
    inFlight.current = true;
    setBusy("import");
    setError(null);
    try {
      if (pdf && pages.length > 1) {
        const built = toDrawingPagesRequest(inspection, form);
        if (!built.ok) return setError(built.error);
        const res = await createDrawingPages(api, projectId, built.body);
        useJobsStore.getState().upsert(res.job);
        onStarted(res.drawings[0]);
      } else {
        const built = toDrawingRequest(inspection, pdf ? { ...form, page: pages[0] ?? form.page } : form);
        if (!built.ok) return setError(built.error);
        const res = await createDrawing(api, projectId, built.body);
        useJobsStore.getState().upsert(res.job);
        onStarted(res.drawing);
      }
    } catch (err) {
      setError(messageOf(err, "could not start the import"));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void startImport();
  }

  const importing = busy === "import";

  const ready = inspection?.state === "ready" && form ? inspection : null;
  const family = ready ? familyOf(ready.format) : null;
  const pageCount = ready ? (ready.page_count ?? ready.pages.length) : 0;
  const multiPdf = family === "pdf" && pageCount > 1;
  const name = ready && form ? drawingNameField(ready, form) : "";

  return (
    <Dialog
      open
      width="lg"
      title="Import drawing"
      description="DXF or LandXML linework, a PDF page, or a PNG, JPG or TIF plan. The file is only read; the import runs in the background."
      onClose={() => !importing && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="import"
            loading={busy === "import"}
            disabled={!ready || importing || (multiPdf && (form?.pages.length ?? 0) === 0)}
          >
            Start import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Section title="File">
          <Field
            label="Drawing file"
            htmlFor="drawing-path"
            error={fileError}
            hint="DXF, LandXML (.xml), PDF, PNG, JPG or TIF."
          >
            <div className="flex gap-2">
              <Input
                id="drawing-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="D:\plans\site-plan.pdf"
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
                label={inspectJob.job?.message || "Reading drawing"}
              />
            ))}
          {inspection?.state === "failed" && <Alert tone="danger">{inspection.error}</Alert>}
          {ready?.warnings.map((w) => (
            <Alert key={w.code} tone="info">
              {w.message}
            </Alert>
          ))}
        </Section>

        {ready && form && family === "pdf" && (
          <Section title={multiPdf ? "Pages" : "Page"}>
            <PdfPagePicker
              pages={ready.pages}
              pageCount={pageCount}
              page={form.page}
              selected={form.pages}
              dpi={form.dpi}
              onChange={(patch) => setForm({ ...form, ...patch })}
              thumbUrl={(n) => pageThumbUrl(baseUrl, token, projectId, ready.id, n)}
            />
          </Section>
        )}
        {ready && family === "raster" && (
          <Section title="Image">
            <p className="font-mono text-xs tabular-nums text-muted">
              {ready.width} × {ready.height} px
            </p>
          </Section>
        )}
        {ready && form && family === "vector" && (
          <Section title="Layers">
            <DrawingLayerPicker
              layers={ready.layers}
              selected={form.layers}
              onChange={(layers) => setForm({ ...form, layers })}
            />
            {ready.format === "landxml" && (
              <p className="text-sm text-muted">
                LandXML linework only: breaklines, alignments and surface boundaries. Import its surfaces
                under Add elevation → Design surface.
              </p>
            )}
          </Section>
        )}
        {ready && form && (
          <Section title="Placement">
            <DrawingPlacementFields inspection={ready} form={form} onChange={setForm} />
            <Field
              label="Name"
              htmlFor="drawing-name"
              hint={
                multiPdf && form.pages.length > 1
                  ? "Each selected page keeps this name, plus its page number."
                  : undefined
              }
            >
              <Input
                id="drawing-name"
                value={name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
          </Section>
        )}
      </div>
    </Dialog>
  );
}
