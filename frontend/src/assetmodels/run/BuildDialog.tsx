import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AssetModel,
  AssetModelRun,
  AssetSourceRef,
  Job,
  KeyedProviderName,
  Provider,
} from "@contract/client";
import { listVersions, startRun } from "@/api/assetModels";
import { useApi } from "@/api/client";
import type { DataItem } from "@/api/dataItems";
import type { UnimportedDrawing } from "@/api/drawings";
import { ApiFailure, codeOf, messageOf } from "@/api/errors";
import { providerLabel, useProviders } from "@/api/providers";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Segmented, Skeleton, Textarea } from "@/ui";
import { DrawingSources } from "./DrawingSources";
import { groupDrawingFiles, type DrawingFile } from "./drawingFiles";
import { importDrawingFile } from "./importFile";
import { GroupHead, SourceRow } from "./SourceRows";
import {
  MAX_SOURCES,
  sourceKey,
  useDataSources,
  usePhotoSources,
  useProjectDrawings,
  useUnimportedDrawings,
} from "./sources";

const NOTES_MAX = 4000;
const MODEL_NAME_MAX = 120;
const SEARCH_DEBOUNCE_MS = 250;

export type RunMode = AssetModelRun["mode"];

/** What a dialog opens with: Try again copies a run's choices, "Refine with this note…" a question. */
export interface BuildInitial {
  sources?: AssetSourceRef[];
  provider?: KeyedProviderName;
  model_name?: string;
  notes?: string | null;
}

export interface BuildDialogProps {
  open: boolean;
  onClose(): void;
  projectId: string;
  model: AssetModel;
  mode: RunMode;
  onStarted(run: AssetModelRun): void;
  initial?: BuildInitial;
}

const START_ERRORS: Record<string, string> = {
  provider_key_missing: "Add this provider's API key in App settings.",
  job_running: "A run is already building this model.",
  no_sources: "A chosen source is missing or not ready.",
  nothing_to_refine: "This model has no version to refine yet.",
};

/** The source a 422 `no_sources` names in its details (`{source: {type, id}}`), if any. */
function badSource(e: unknown): AssetSourceRef | null {
  const src = e instanceof ApiFailure ? (e.details.source as Partial<AssetSourceRef> | undefined) : undefined;
  return src && typeof src.id === "string" && typeof src.type === "string" ? (src as AssetSourceRef) : null;
}

function startError(e: unknown): string {
  const code = codeOf(e);
  if (code && START_ERRORS[code]) return START_ERRORS[code];
  if (code === "not_found") return "This asset model is no longer in the project.";
  return messageOf(e, "The run could not be started.");
}

/** The first provider with a key, Anthropic first. */
function defaultProvider(providers: Provider[]): KeyedProviderName | null {
  const keyed = providers.filter((p) => p.has_key);
  return (keyed.find((p) => p.name === "anthropic") ?? keyed[0])?.name ?? null;
}

function DataGroup({
  title,
  empty,
  items,
  error,
  isChosen,
  onToggle,
}: {
  title: string;
  empty: string;
  items: DataItem[] | null;
  error: string | null;
  isChosen(ref: AssetSourceRef): boolean;
  onToggle(ref: AssetSourceRef, on: boolean): void;
}) {
  const chosen =
    items?.filter((i) => isChosen({ type: i.type as AssetSourceRef["type"], id: i.id })).length ?? 0;
  return (
    <fieldset className="min-w-0">
      <GroupHead title={title} chosen={chosen} total={items?.length ?? null} />
      {items === null ? (
        <Skeleton className="h-7 w-full" />
      ) : error ? (
        <p className="text-xs text-danger">{`The list could not be loaded: ${error}`}</p>
      ) : items.length === 0 ? (
        <p className="px-1.5 text-xs text-dim">{empty}</p>
      ) : (
        <ul className="flex max-h-32 flex-col overflow-y-auto">
          {items.map((i) => {
            const ref = { type: i.type as AssetSourceRef["type"], id: i.id };
            return (
              <SourceRow
                key={i.id}
                label={i.label}
                status={i.status}
                checked={isChosen(ref)}
                onChange={(on) => onToggle(ref, on)}
              />
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

function PhotoGroup({
  projectId,
  chosen,
  isChosen,
  onToggle,
}: {
  projectId: string;
  chosen: number;
  isChosen(ref: AssetSourceRef): boolean;
  onToggle(ref: AssetSourceRef, on: boolean): void;
}) {
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(filter.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [filter]);
  const photos = usePhotoSources(projectId, search);
  return (
    <fieldset className="min-w-0">
      <GroupHead title="Photos" chosen={chosen} total={photos.total} />
      <Input
        dense
        aria-label="Filter photos"
        placeholder="Filter by file name"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-1.5"
      />
      {photos.items === null ? (
        <Skeleton className="h-7 w-full" />
      ) : photos.items.length === 0 && !photos.error ? (
        <p className="px-1.5 text-xs text-dim">
          {search ? "No photo matches the filter." : "No photos in this project."}
        </p>
      ) : (
        <ul className="flex max-h-40 flex-col overflow-y-auto">
          {photos.items.map((img) => {
            const ref = { type: "image" as const, id: img.id };
            return (
              <SourceRow
                key={img.id}
                label={<span className="font-mono text-xs">{img.file_name}</span>}
                checked={isChosen(ref)}
                onChange={(on) => onToggle(ref, on)}
              />
            );
          })}
          {photos.hasMore && (
            <li className="pt-1">
              <Button size="sm" variant="ghost" loading={photos.loading} onClick={photos.more}>
                Show more
              </Button>
            </li>
          )}
        </ul>
      )}
      {photos.error && <p className="mt-1 text-xs text-danger">{`Photos: ${photos.error}`}</p>}
    </fieldset>
  );
}

/** An "Import and include" whose job is being watched: its drawings, and whether the job has ended. */
interface ImportRun {
  jobId: string;
  name: string;
  ids: string[];
  ended: boolean;
  failed: boolean;
}

/** Watches one import job (the store's copy, polled by `useTrackedJob`) and reports its end once. */
function ImportWatch({
  projectId,
  run,
  onEnd,
}: {
  projectId: string;
  run: ImportRun;
  onEnd(run: ImportRun, job: Job): void;
}) {
  const { job } = useTrackedJob(projectId, run.jobId);
  const fired = useRef(false);
  useEffect(() => {
    if (!job || isActiveJob(job) || fired.current) return;
    fired.current = true;
    onEnd(run, job);
  }, [job, run, onEnd]);
  return null;
}

/**
 * Starts an asset model run (M1 spec §8): the sources to read, the provider and model, and notes for
 * the agent. Build writes a new model from the sources; Refine starts from the current version.
 */
export function BuildDialog({ open, onClose, projectId, model, mode, onStarted, initial }: BuildDialogProps) {
  const api = useApi();
  const { providers, loading: providersLoading, unavailable, error: providersError } = useProviders();
  const drawingList = useProjectDrawings(projectId);
  const files = useMemo(
    () => (drawingList.items ? groupDrawingFiles(drawingList.items) : null),
    [drawingList.items],
  );
  const unimported = useUnimportedDrawings(projectId);
  const [importing, setImporting] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<Record<string, string>>({});
  const [importRuns, setImportRuns] = useState<ImportRun[]>([]);
  const [importNotices, setImportNotices] = useState<string[]>([]);
  const { reload: reloadDrawings, add: addDrawings } = drawingList;
  const onImportEnd = useCallback(
    (run: ImportRun, job: Job) => {
      const failed = job.state !== "succeeded";
      setImportRuns((rs) => rs.map((r) => (r.jobId === run.jobId ? { ...r, ended: true, failed } : r)));
      if (failed) {
        const why =
          job.error ?? (job.state === "cancelled" ? "the import was cancelled" : "the import failed");
        setImportNotices((n) => [...n, `${run.name} could not be imported: ${why}`]);
      }
      reloadDrawings();
    },
    [reloadDrawings],
  );
  const clouds = useDataSources(projectId, "point_cloud");

  // Refine starts from the current version's sources unless the caller brought its own.
  const [versionSources, setVersionSources] = useState<AssetSourceRef[] | null>(null);
  const wantsVersionSources = mode === "refine" && !initial?.sources && model.current_version != null;
  useEffect(() => {
    if (!wantsVersionSources) return;
    let live = true;
    listVersions(api, projectId, model.id).then(
      (vs) =>
        live && setVersionSources(vs.find((v) => v.version === model.current_version)?.source_ids ?? []),
      () => live && setVersionSources([]),
    );
    return () => {
      live = false;
    };
  }, [api, projectId, model.id, model.current_version, wantsVersionSources]);

  /** null until the operator changes the selection: the defaults show through until then. */
  const [picked, setPicked] = useState<Map<string, AssetSourceRef> | null>(null);
  const seeded = useMemo(() => {
    if (picked) return picked;
    const start = initial?.sources ?? versionSources ?? [];
    return new Map(start.map((r) => [sourceKey(r), r]));
  }, [picked, initial?.sources, versionSources]);
  // A seeded drawing or cloud that is not in its (loaded) list any more was deleted: it is left out.
  // Photos are paged, so a chosen photo off the loaded pages is kept.
  const { chosen, dropped } = useMemo(() => {
    const listed = (type: AssetSourceRef["type"]) => {
      if (type === "drawing")
        return !drawingList.items || drawingList.error ? null : new Set(drawingList.items.map((d) => d.id));
      return type === "point_cloud" && clouds.items && !clouds.error
        ? new Set(clouds.items.map((i) => i.id))
        : null;
    };
    const ids = { drawing: listed("drawing"), point_cloud: listed("point_cloud"), image: null };
    const kept = new Map<string, AssetSourceRef>();
    let gone = 0;
    for (const [k, r] of seeded) {
      const known = ids[r.type];
      if (known && !known.has(r.id)) gone += 1;
      else kept.set(k, r);
    }
    return { chosen: kept, dropped: gone };
  }, [seeded, drawingList.items, drawingList.error, clouds]);
  const isChosen = (r: AssetSourceRef) => chosen.has(sourceKey(r));
  // An import awaits the server: it adds its pages to the selection as it stands then, not as it was.
  const chosenNow = useRef(chosen);
  useEffect(() => {
    chosenNow.current = chosen;
  }, [chosen]);
  // Once an import's job has ended and the list re-reads, its failed pages leave the selection
  // (a tick sends only ready pages, as DrawingFile.refs does).
  useEffect(() => {
    const items = drawingList.items;
    if (!items) return;
    const settled = importRuns.filter(
      (r) => r.ended && !items.some((d) => r.ids.includes(d.id) && d.status === "importing"),
    );
    if (settled.length === 0) return;
    const next = new Map(chosenNow.current);
    const notes: string[] = [];
    for (const r of settled) {
      const failed = items.filter((d) => r.ids.includes(d.id) && d.status === "failed").map((d) => d.id);
      for (const id of failed) next.delete(sourceKey({ type: "drawing", id }));
      if (failed.length > 0 && !r.failed)
        notes.push(
          failed.length === r.ids.length
            ? `${r.name} could not be imported.`
            : `${failed.length} of ${r.ids.length} pages of ${r.name} could not be imported and were left out.`,
        );
    }
    if (next.size !== chosenNow.current.size) setPicked(next);
    if (notes.length > 0) setImportNotices((n) => [...n, ...notes]);
    setImportRuns((rs) => rs.filter((r) => !settled.includes(r)));
  }, [importRuns, drawingList.items]);
  const onToggle = (r: AssetSourceRef, on: boolean) => {
    const next = new Map(chosen);
    if (on) next.set(sourceKey(r), r);
    else next.delete(sourceKey(r));
    setPicked(next);
  };
  const onToggleFile = (file: DrawingFile, on: boolean) => {
    const next = new Map(chosen);
    for (const d of file.drawings) next.delete(sourceKey({ type: "drawing", id: d.id }));
    if (on) for (const r of file.refs) next.set(sourceKey(r), r);
    setPicked(next);
  };
  const onImport = async (file: UnimportedDrawing) => {
    if (importing) return;
    setImporting(file.path);
    setImportErrors((m) => {
      const next = { ...m };
      delete next[file.path];
      return next;
    });
    try {
      const { drawings: made, job } = await importDrawingFile(api, projectId, file.path);
      addDrawings(made);
      const next = new Map(chosenNow.current);
      for (const d of made) next.set(sourceKey({ type: "drawing", id: d.id }), { type: "drawing", id: d.id });
      setPicked(next);
      unimported.drop(file.path);
      setImportRuns((rs) => [
        ...rs,
        { jobId: job.id, name: file.name, ids: made.map((d) => d.id), ended: false, failed: false },
      ]);
    } catch (e) {
      setImportErrors((m) => ({ ...m, [file.path]: messageOf(e, "The file could not be imported.") }));
    } finally {
      setImporting(null);
    }
  };
  const waiting = [...chosen.values()].filter(
    (r) => r.type === "drawing" && drawingList.items?.find((d) => d.id === r.id)?.status === "importing",
  ).length;
  const photosChosen = [...chosen.values()].filter((r) => r.type === "image").length;

  const [providerPick, setProviderPick] = useState<KeyedProviderName | null>(initial?.provider ?? null);
  const pickedProvider = providers.find((p) => p.name === providerPick && p.has_key);
  const provider = pickedProvider?.name ?? defaultProvider(providers);
  const providerRow = providers.find((p) => p.name === provider) ?? null;
  const [modelName, setModelName] = useState<string | null>(null);
  // A copied model name belongs to its provider: once another one is chosen (the original lost its
  // key, say), that provider's default applies.
  const initialModel =
    initial?.model_name && (provider === null || provider === initial.provider) ? initial.model_name : null;
  const shownModelName = modelName ?? initialModel ?? providerRow?.model_name ?? "";
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const keyless = providers.filter((p) => !p.has_key);

  const sourceName = (r: AssetSourceRef) => {
    const label =
      r.type === "drawing"
        ? drawingList.items?.find((d) => d.id === r.id)?.name
        : r.type === "point_cloud"
          ? clouds.items?.find((i) => i.id === r.id)?.label
          : undefined;
    return (
      label ??
      (r.type === "image"
        ? "A chosen photo"
        : r.type === "drawing"
          ? "A chosen drawing"
          : "A chosen point cloud")
    );
  };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooMany = chosen.size > MAX_SOURCES;
  const canStart = chosen.size > 0 && !tooMany && waiting === 0 && provider !== null && !busy;

  const submit = async () => {
    if (!canStart || !provider) return;
    setBusy(true);
    setError(null);
    try {
      const { run, job } = await startRun(api, projectId, model.id, {
        mode,
        provider,
        model_name: shownModelName.trim() || null,
        sources: [...chosen.values()],
        notes: notes.trim() || null,
      });
      useJobsStore.getState().upsert(job);
      onStarted(run);
    } catch (e) {
      const bad = codeOf(e) === "no_sources" ? badSource(e) : null;
      if (bad && chosen.has(sourceKey(bad))) {
        const next = new Map(chosen);
        next.delete(sourceKey(bad));
        setPicked(next);
        setError(
          `${sourceName(bad)} is missing or not ready, so it was taken out. Start again to run without it.`,
        );
      } else setError(startError(e));
      setBusy(false);
    }
  };

  const refine = mode === "refine";
  return (
    <Dialog
      open={open}
      width="lg"
      title={refine ? "Refine with AI" : "Build with AI"}
      description={
        refine
          ? `The agent starts from version ${model.current_version ?? "–"} and saves what it changes as a new version.`
          : "The agent reads the sources you pick and builds the model as a new version."
      }
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="sparkle" loading={busy} disabled={!canStart}>
            {refine ? "Start refine" : "Start build"}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-label="Sources" className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">
            Sources
            {chosen.size > 0 && (
              <span className="ml-2 font-mono text-2xs font-medium tabular-nums text-muted">
                {chosen.size} / {MAX_SOURCES}
              </span>
            )}
          </h3>
          <DrawingSources
            files={files}
            error={drawingList.error}
            isChosen={isChosen}
            onToggleFile={onToggleFile}
            unimported={unimported.items}
            unimportedError={unimported.error}
            importing={importing}
            importErrors={importErrors}
            onImport={(f) => void onImport(f)}
          />
          <DataGroup
            title="Point clouds"
            empty="No point clouds in this project."
            items={clouds.items}
            error={clouds.error}
            isChosen={isChosen}
            onToggle={onToggle}
          />
          <PhotoGroup projectId={projectId} chosen={photosChosen} isChosen={isChosen} onToggle={onToggle} />
          {tooMany && (
            <p role="alert" className="text-xs text-danger">
              {`A run reads at most ${MAX_SOURCES} sources; untick ${chosen.size - MAX_SOURCES}.`}
            </p>
          )}
          {dropped > 0 && (
            <p className="text-xs text-muted">
              {dropped === 1
                ? "1 source is no longer in the project and was left out."
                : `${dropped} sources are no longer in the project and were left out.`}
            </p>
          )}
          {importRuns
            .filter((r) => !r.ended)
            .map((r) => (
              <ImportWatch key={r.jobId} projectId={projectId} run={r} onEnd={onImportEnd} />
            ))}
          {importNotices.map((n, i) => (
            <p key={i} role="alert" className="text-xs text-danger">
              {n}
            </p>
          ))}
          {waiting > 0 && (
            <p className="text-xs text-muted">
              {`Waiting for ${waiting} ${waiting === 1 ? "drawing" : "drawings"} to finish importing.`}
            </p>
          )}
        </section>

        <section aria-label="Agent" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Provider</span>
            {providersLoading ? (
              <Skeleton className="h-[34px] w-full" />
            ) : unavailable || providers.length === 0 ? (
              <p className="text-xs text-muted">
                No AI provider is set up.{" "}
                <Link to="/settings" className="text-accent-ink underline underline-offset-2">
                  Add a key in App settings
                </Link>
              </p>
            ) : (
              <>
                <Segmented
                  label="Provider"
                  className="w-fit max-w-full flex-wrap"
                  value={provider ?? ("" as KeyedProviderName)}
                  onChange={(p) => {
                    setProviderPick(p);
                    setModelName(null);
                  }}
                  options={providers.map((p) => ({
                    value: p.name,
                    label: providerLabel(p.name),
                    disabled: !p.has_key,
                  }))}
                />
                {keyless.length > 0 && (
                  <p className="text-xs leading-relaxed text-muted">
                    {`${keyless.map((p) => providerLabel(p.name)).join(" and ")} ${keyless.length === 1 ? "has" : "have"} no API key. `}
                    <Link to="/settings" className="text-accent-ink underline underline-offset-2">
                      Add a key in App settings
                    </Link>
                  </p>
                )}
              </>
            )}
            {providersError && <p className="text-xs text-danger">{providersError}</p>}
          </div>
          <Field label="Model" htmlFor="build-model-name" hint="The provider's default unless you change it">
            <Input
              id="build-model-name"
              value={shownModelName}
              maxLength={MODEL_NAME_MAX}
              onChange={(e) => setModelName(e.target.value)}
              className="font-mono"
            />
          </Field>
          <Field
            label="Notes"
            htmlFor="build-notes"
            hint={
              <span className="flex justify-between gap-3">
                <span>What the sources don&apos;t say, or what to fix</span>
                <span className="font-mono tabular-nums">
                  {notes.length.toLocaleString()} / {NOTES_MAX.toLocaleString()}
                </span>
              </span>
            }
          >
            <Textarea
              id="build-notes"
              rows={5}
              maxLength={NOTES_MAX}
              value={notes}
              placeholder="N7 is at 270°, not 90°"
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </section>
      </div>
      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
    </Dialog>
  );
}
