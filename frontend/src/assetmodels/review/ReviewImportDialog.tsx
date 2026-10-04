// Spec §6.5: import a kit job folder. A dry run reads the folder and matches the photos without
// writing anything; the operator checks the preview and confirms the class mapping; then the real
// import runs as a background job.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@contract/client";
import { startReviewImport, type ReviewImportPreview, type ReviewImportRequest } from "@/api/assetReview";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchAllSources } from "@/api/sources";
import { useAssetModelList } from "@/assetmodels/useAssetModels";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Combobox, Dialog, Field, Input, Pill, Progress, Select, claimJobOutcome } from "@/ui";
import { REASON_TEXT, blockers, matchedByText, missingClasses, prefillClassMap } from "./reviewImport";

const n = (x: number) => x.toLocaleString("en-US");

export function ReviewImportDialog({
  projectId,
  modelId = null,
  onClose,
  onStarted,
}: {
  projectId: string;
  modelId?: string | null;
  onClose(): void;
  onStarted(job: Job): void;
}) {
  const api = useApi();
  const { mode } = useBackend();
  const { models } = useAssetModelList(projectId);
  const { defectTypes } = useProjectTypes(projectId);
  const [sources, setSources] = useState<{ id: string; label: string }[] | null>(null);
  const [folder, setFolder] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [target, setTarget] = useState<string>(modelId ?? "");
  const [newName, setNewName] = useState("");
  const [dryJobId, setDryJobId] = useState<string | null>(null);
  const [map, setMap] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const release = useRef<(() => void) | null>(null);

  useEffect(() => {
    fetchAllSources(api, projectId).then(
      (all) => {
        const images = all
          .filter((s) => s.kind === "images")
          .map((s) => ({ id: s.id, label: s.label ?? s.folder }));
        setSources(images);
        setSourceId((cur) => cur || (images[0]?.id ?? ""));
      },
      (e: unknown) => setError(messageOf(e, "The image sets could not be loaded.")),
    );
  }, [api, projectId]);
  useEffect(() => () => release.current?.(), []);

  const tracked = useTrackedJob(projectId, dryJobId);
  const dry = tracked.job;
  const preview = dry?.state === "succeeded" ? (dry.result as unknown as ReviewImportPreview | null) : null;
  const dryError = dry?.state === "failed" ? (dry.error ?? "The folder could not be read.") : tracked.error;
  const checking = dryJobId !== null && !preview && !dryError && (!dry || isActiveJob(dry));
  const endedEmpty = dryJobId !== null && !!dry && !isActiveJob(dry) && !preview && !dryError;

  // Prefill the mapping once per preview: the server's suggestion, else a name match.
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!preview || !dry || prefilledFor.current === dry.id) return;
    prefilledFor.current = dry.id;
    setMap(prefillClassMap(preview.classes, defectTypes));
  }, [preview, dry, defectTypes]);

  const request = (dryRun: boolean): ReviewImportRequest => ({
    folder: folder.trim(),
    image_source_id: sourceId,
    ...(target ? { asset_model_id: target } : { new_model_name: newName.trim() }),
    ...(dryRun
      ? {}
      : {
          class_map: Object.fromEntries(Object.entries(map).filter(([, v]) => !!v)) as Record<string, string>,
        }),
    dry_run: dryRun,
  });
  const formReady = folder.trim() !== "" && sourceId !== "" && (target !== "" || newName.trim() !== "");
  const missing = preview ? missingClasses(preview.classes, map) : [];
  const stops = preview ? blockers(preview) : [];
  const canImport = !!preview && missing.length === 0 && stops.length === 0 && !busy;
  const matchedBy = preview ? matchedByText(preview.matched_by) : null;

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") setFolder(picked);
  }

  async function check() {
    setBusy(true);
    setError(null);
    release.current?.();
    try {
      const job = await startReviewImport(api, projectId, request(true));
      release.current = claimJobOutcome(job.id); // the preview is shown here, not as a toast
      useJobsStore.getState().upsert(job);
      setDryJobId(job.id);
    } catch (e) {
      setError(messageOf(e, "The folder could not be checked."));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const job = await startReviewImport(api, projectId, request(false));
      useJobsStore.getState().upsert(job);
      onStarted(job);
    } catch (e) {
      setError(messageOf(e, "The import could not start."));
    } finally {
      setBusy(false);
    }
  }

  const typeItems = useMemo(
    () => defectTypes.map((t) => ({ id: t.id, label: t.name, colour: t.colour })),
    [defectTypes],
  );
  const reasons =
    preview?.unmatched_reasons ??
    (preview?.unmatched ?? []).map((s) => ({ kit_id: s, source_name: s, reason: "not_found" as const }));

  return (
    <Dialog
      open
      width="lg"
      title="Import inspection review"
      description="A review job folder (job.yaml, cameras, assessment and masks) becomes sightings and findings on an asset model. Nothing is written until you press Import."
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {preview ? (
            <Button
              variant="primary"
              icon="import"
              loading={busy}
              disabled={!canImport}
              onClick={() => void run()}
            >
              Import
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy || checking}
              disabled={!formReady || checking}
              onClick={() => void check()}
            >
              Check the folder
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Review job folder" htmlFor="kit-folder" error={error}>
          <div className="flex gap-2">
            <Input
              id="kit-folder"
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setDryJobId(null);
              }}
              placeholder="D:\reviews\tower\job"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && <Button onClick={() => void browse()}>Browse</Button>}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Image set with the photos" htmlFor="kit-source">
            <Select
              id="kit-source"
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setDryJobId(null);
              }}
            >
              {(sources ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Asset model" htmlFor="kit-model">
            <Select
              id="kit-model"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setDryJobId(null);
              }}
            >
              <option value="">A new asset model</option>
              {(models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {target === "" && (
          <Field label="New asset model name" htmlFor="kit-name">
            <Input
              id="kit-name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setDryJobId(null);
              }}
            />
          </Field>
        )}
        {sources && sources.length === 0 && (
          <Alert tone="warn">
            Import the review&apos;s photos first (Add data, Photos). The kit&apos;s photos are matched to
            them.
          </Alert>
        )}
        {checking && <Progress thin running value={dry?.progress ?? undefined} label="Checking the folder" />}
        {dryError && <Alert tone="danger">{dryError}</Alert>}
        {endedEmpty && <Alert tone="warn">The check ended without a preview. Try again.</Alert>}
        {preview && (
          <section
            aria-label="What this import will do"
            className="flex flex-col gap-3 border-t border-line pt-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Pill size="sm">{preview.profile}</Pill>
              <span className="text-muted">
                {preview.unit === "region" ? "One finding per region" : "One finding per photo"}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Photos</dt>
              <dd className="text-ink">
                {`${n(preview.matched)} of ${n(preview.photos)} photos matched`}
                {matchedBy ? ` (${matchedBy})` : ""}
              </dd>
              <dt className="text-muted">Sightings</dt>
              <dd className="text-ink">{`${n(preview.sightings ?? preview.classes.reduce((a, c) => a + c.count, 0))} sightings`}</dd>
              <dt className="text-muted">Photo review</dt>
              <dd className="text-ink">
                {`${n(preview.statuses.finding)} with findings, ${n(preview.statuses.uncertain)} uncertain, ${n(preview.statuses.none)} no finding, ${n(preview.statuses.not_assessed)} not assessed`}
              </dd>
              <dt className="text-muted">In the folder</dt>
              <dd className="text-ink">
                {[
                  preview.has_surface ? "placements to replay" : "placements computed after import",
                  preview.has_merged ? "polygons" : "boxes only",
                  preview.has_glb ? "a GLB" : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </dd>
            </dl>
            {stops.map((s) => (
              <Alert key={s} tone="danger">
                {s}
              </Alert>
            ))}
            {preview.unmatched_count > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-ink">{`${n(preview.unmatched_count)} photos not matched; they are left out`}</summary>
                <ul aria-label="Photos not matched" className="mt-1 max-h-40 overflow-y-auto">
                  {reasons.map((r) => (
                    <li key={r.kit_id} className="flex gap-2 py-0.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                        {r.source_name}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{REASON_TEXT[r.reason]}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <table aria-label="Class mapping" className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 font-normal">Kit class</th>
                  <th className="py-1 font-normal">Sightings</th>
                  <th className="py-1 font-normal">Catalogue type</th>
                </tr>
              </thead>
              <tbody>
                {preview.classes.map((c) => (
                  <tr key={c.key} aria-label={c.label}>
                    <td className="py-1 pr-2 text-ink">
                      {c.label} <span className="font-mono text-xs text-muted">{c.key}</span>
                    </td>
                    <td className="py-1 pr-2 tabular-nums text-ink">{n(c.count)}</td>
                    <td className="py-1">
                      <Combobox
                        label={`Type for ${c.label}`}
                        items={typeItems}
                        value={map[c.key] ?? null}
                        onChange={(id) => setMap((m) => ({ ...m, [c.key]: id }))}
                        triggerPlaceholder="Choose a type"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {missing.length > 0 && (
              <p className="text-xs text-warn">{`${missing.length} ${missing.length === 1 ? "class still needs" : "classes still need"} a type.`}</p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
