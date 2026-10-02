import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  AssetModel,
  AssetModelRun,
  AssetSourceRef,
  KeyedProviderName,
  Provider,
} from "@contract/client";
import { listVersions, startRun } from "@/api/assetModels";
import { useApi } from "@/api/client";
import type { DataItem } from "@/api/dataItems";
import { codeOf, messageOf } from "@/api/errors";
import { providerLabel, useProviders } from "@/api/providers";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Checkbox, Dialog, Field, Input, Pill, Segmented, Skeleton, Textarea } from "@/ui";
import { MAX_SOURCES, sourceKey, useDataSources, usePhotoSources } from "./sources";

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

const STATUS_TEXT: Record<DataItem["status"], string> = {
  ready: "Ready",
  importing: "Importing",
  failed: "Failed",
};

function GroupHead({ title, chosen, total }: { title: string; chosen: number; total: number | null }) {
  return (
    <legend className="mb-1.5 flex w-full items-baseline gap-2 text-xs font-medium text-muted">
      <span className="text-ink">{title}</span>
      <span className="font-mono text-2xs tabular-nums text-dim">
        {chosen > 0 ? `${chosen} chosen · ` : ""}
        {total ?? "…"}
      </span>
    </legend>
  );
}

function SourceRow({
  label,
  status,
  checked,
  onChange,
}: {
  label: ReactNode;
  status?: DataItem["status"];
  checked: boolean;
  onChange(on: boolean): void;
}) {
  const ready = !status || status === "ready";
  return (
    <li className="flex min-h-7 items-center rounded-sm px-1.5 hover:bg-hover">
      <Checkbox
        checked={checked}
        disabled={!ready}
        onChange={(e) => onChange(e.target.checked)}
        className="min-w-0 flex-1"
        label={
          <span className="flex min-w-0 items-center gap-2">
            <span className={ready ? "truncate text-ink" : "truncate text-dim"}>{label}</span>
            {!ready && status && (
              <Pill size="sm" tone={status === "failed" ? "danger" : "warn"}>
                {STATUS_TEXT[status]}
              </Pill>
            )}
          </span>
        }
      />
    </li>
  );
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

/**
 * Starts an asset model run (M1 spec §8): the sources to read, the provider and model, and notes for
 * the agent. Build writes a new model from the sources; Refine starts from the current version.
 */
export function BuildDialog({ open, onClose, projectId, model, mode, onStarted, initial }: BuildDialogProps) {
  const api = useApi();
  const { providers, loading: providersLoading, unavailable, error: providersError } = useProviders();
  const drawings = useDataSources(projectId, "drawing");
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
  const chosen = useMemo(() => {
    if (picked) return picked;
    const start = initial?.sources ?? versionSources ?? [];
    return new Map(start.map((r) => [sourceKey(r), r]));
  }, [picked, initial?.sources, versionSources]);
  const isChosen = (r: AssetSourceRef) => chosen.has(sourceKey(r));
  const onToggle = (r: AssetSourceRef, on: boolean) => {
    const next = new Map(chosen);
    if (on) next.set(sourceKey(r), r);
    else next.delete(sourceKey(r));
    setPicked(next);
  };
  const photosChosen = [...chosen.values()].filter((r) => r.type === "image").length;

  const [providerPick, setProviderPick] = useState<KeyedProviderName | null>(initial?.provider ?? null);
  const pickedProvider = providers.find((p) => p.name === providerPick && p.has_key);
  const provider = pickedProvider?.name ?? defaultProvider(providers);
  const providerRow = providers.find((p) => p.name === provider) ?? null;
  const [modelName, setModelName] = useState<string | null>(initial?.model_name ?? null);
  const shownModelName = modelName ?? providerRow?.model_name ?? "";
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const keyless = providers.filter((p) => !p.has_key);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooMany = chosen.size > MAX_SOURCES;
  const canStart = chosen.size > 0 && !tooMany && provider !== null && !busy;

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
      setError(startError(e));
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
          <DataGroup
            title="Drawings"
            empty="No drawings in this project."
            items={drawings.items}
            error={drawings.error}
            isChosen={isChosen}
            onToggle={onToggle}
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
