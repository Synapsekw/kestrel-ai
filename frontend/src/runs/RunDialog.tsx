import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { GeoMap, ProviderName, Source } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { useProject } from "@/api/project";
import { providerLabel, useProviders } from "@/api/providers";
import { createRuns, saveModelClassMap, unmappedClasses, type RunCreate, type RunCreated } from "@/api/runs";
import { fetchAllSources } from "@/api/sources";
import { useLibraryModels } from "@/library/useLibraryModels";
import { useJobsStore } from "@/store/jobs";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Disclosure,
  Field,
  Input,
  Pill,
  Segmented,
  Select,
  Skeleton,
} from "@/ui";
import { ClassMappingStep } from "./ClassMappingStep";
import { mappingBody, unchosen, type Choice } from "./classMapping";
import { gsdWarning, runSources, type RunSource } from "./runSources";

type Detector = "local_model" | "cloud_provider";
type Step = { kind: "setup" } | { kind: "mapping"; modelId: string; unmapped: string[] };

const DEFAULT_TILING = { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 };

/**
 * Start runs: pick sources, a library model (or a cloud provider) and a confidence; each source
 * gets its own run. When the model has classes the project has no class for, the server answers
 * `422 unmapped_classes` before anything starts; the dialog then asks once what each becomes,
 * saves that and starts the same runs again.
 */
export function RunDialog({
  projectId,
  initialSourceIds = [],
  onClose,
  onStarted,
}: {
  projectId: string;
  /** Source ids to start with; a map id picks the map's source. */
  initialSourceIds?: string[];
  onClose: () => void;
  onStarted: (created: RunCreated) => void;
}) {
  const api = useApi();
  const registry = useLibraryModels();
  const providers = useProviders();
  const { project, reload: reloadProject } = useProject(projectId);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [maps, setMaps] = useState<GeoMap[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialSourceIds));
  const [detector, setDetector] = useState<Detector>("local_model");
  const [modelId, setModelId] = useState("");
  const [provider, setProvider] = useState<ProviderName>("anthropic");
  const [query, setQuery] = useState("");
  const [conf, setConf] = useState("0.25");
  const [tiling, setTiling] = useState(true);
  const [tileSize, setTileSize] = useState(String(DEFAULT_TILING.tile_size));
  const [gsd, setGsd] = useState("");
  const [step, setStep] = useState<Step>({ kind: "setup" });
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAllSources(api, projectId), listMaps(api, projectId).catch(() => [] as GeoMap[])])
      .then(([s, m]) => {
        if (cancelled) return;
        setSources(s);
        setMaps(m);
        // A map may be named by its own id (the map viewer does); pick its source instead.
        setPicked((was) => new Set([...was].map((id) => s.find((x) => x.map_id === id)?.id ?? id)));
      })
      .catch((e: unknown) => !cancelled && setLoadError(messageOf(e, "could not load the sources")));
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);

  const options = useMemo(() => runSources(sources ?? [], maps), [sources, maps]);
  const ready = registry.models.filter((m) => m.state === "ready");
  const effectiveModel = modelId || ready[0]?.id || "";
  const model = registry.models.find((m) => m.id === effectiveModel);
  const chosen = options.filter((o) => picked.has(o.id));
  const hasPhotos = chosen.some((o) => o.kind === "images");
  const hasMaps = chosen.some((o) => o.kind === "map");
  const warnings =
    detector === "local_model"
      ? chosen.filter((o) => o.kind === "map").flatMap((o) => gsdWarning(o, model?.train_gsd_cm) ?? [])
      : [];

  const toggle = (id: string) =>
    setPicked((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  function body(): RunCreate {
    return {
      source_ids: chosen.map((o) => o.id),
      conf: Number(conf),
      ...(detector === "local_model" ? { model_id: effectiveModel } : { provider, query: query.trim() }),
      ...(hasPhotos ? { tiling: { ...DEFAULT_TILING, enabled: tiling, tile_size: Number(tileSize) } } : {}),
      ...(hasMaps && gsd ? { target_gsd_cm: Number(gsd) } : {}),
    };
  }

  function problem(): string | null {
    if (chosen.length === 0) return "Choose at least one source.";
    if (detector === "local_model" && !effectiveModel) return "Choose a model.";
    if (detector === "cloud_provider") {
      if (!providers.providers.find((p) => p.name === provider)?.has_key)
        return "Add an API key for this provider in App settings first.";
      if (!query.trim()) return 'Describe what to find, e.g. "excavators".';
    }
    const c = Number(conf);
    if (!(c >= 0 && c <= 1)) return "Confidence is a number from 0 to 1.";
    return null;
  }

  async function start() {
    try {
      const created = await createRuns(api, projectId, body());
      for (const r of created.runs) useJobsStore.getState().upsert(r.job);
      onStarted(created);
    } catch (err) {
      const missing = unmappedClasses(err);
      if (missing) {
        reloadProject();
        setChoices({});
        setStep({ kind: "mapping", modelId: missing.modelId, unmapped: missing.unmapped });
        return;
      }
      setError(messageOf(err, "could not start the runs"));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (step.kind === "mapping") {
      const left = unchosen(step.unmapped, choices);
      if (left.length) return setError(`Choose what ${left.join(", ")} counts as.`);
      setBusy(true);
      try {
        await saveModelClassMap(api, projectId, step.modelId, mappingBody(choices));
        setStep({ kind: "setup" });
        await start();
      } catch (err) {
        setError(messageOf(err, "could not save the class mapping"));
      } finally {
        setBusy(false);
      }
      return;
    }
    const p = problem();
    if (p) return setError(p);
    setBusy(true);
    try {
      await start();
    } finally {
      setBusy(false);
    }
  }

  const runs = chosen.length === 1 ? "run" : `${chosen.length} runs`;
  const footer =
    step.kind === "mapping" ? (
      <>
        <Button onClick={() => setStep({ kind: "setup" })} disabled={busy}>
          Back
        </Button>
        <Button type="submit" variant="primary" icon="play" loading={busy}>
          Save and start
        </Button>
      </>
    ) : (
      <>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon="detect" loading={busy} disabled={!sources}>
          {chosen.length > 1 ? `Start ${runs}` : "Start run"}
        </Button>
      </>
    );

  return (
    <Dialog
      open
      width="lg"
      title={step.kind === "mapping" ? "Match the model's classes" : "New run"}
      description={
        step.kind === "mapping" ? undefined : "Each source you pick gets its own run, in the background."
      }
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={footer}
    >
      {step.kind === "mapping" ? (
        <ClassMappingStep
          modelName={model?.name ?? "The model"}
          unmapped={step.unmapped}
          classes={project?.classes ?? []}
          choices={choices}
          onChange={setChoices}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-ink">Sources</legend>
            {loadError && <Alert tone="danger">{loadError}</Alert>}
            {!sources && !loadError && <Skeleton className="h-16 w-full" />}
            {sources && options.length === 0 && (
              <p className="text-sm text-muted">Add photos or a map under Sources first.</p>
            )}
            {options.length > 0 && (
              <ul className="max-h-56 overflow-y-auto rounded-[10px] border border-line">
                {options.map((o) => (
                  <SourceRow key={o.id} source={o} checked={picked.has(o.id)} onToggle={() => toggle(o.id)} />
                ))}
              </ul>
            )}
          </fieldset>

          <Segmented
            label="Detector"
            value={detector}
            onChange={setDetector}
            options={[
              { value: "local_model", label: "Library model" },
              { value: "cloud_provider", label: "Cloud provider" },
            ]}
          />

          {detector === "local_model" ? (
            <Field
              label="Model"
              htmlFor="run-model"
              hint={
                model
                  ? `${model.task === "obb" ? "Rotated boxes" : "Boxes"} · finds ${model.class_names.join(", ")}${model.train_gsd_cm ? ` · trained at ${model.train_gsd_cm.toFixed(1)} cm / px` : ""}`
                  : registry.unavailable
                    ? "The model library could not be opened."
                    : "Import or train a model in the Library first."
              }
            >
              <Select id="run-model" value={effectiveModel} onChange={(e) => setModelId(e.target.value)}>
                {!effectiveModel && <option value="">Choose a model</option>}
                {registry.models.map((m) => (
                  <option key={m.id} value={m.id} disabled={m.state !== "ready"}>
                    {m.name}
                    {m.state !== "ready" ? " (file missing)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider" htmlFor="run-provider">
                <Select
                  id="run-provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as ProviderName)}
                >
                  {providers.providers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {providerLabel(p.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="What to find" htmlFor="run-query">
                <Input
                  id="run-query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="excavators"
                />
              </Field>
            </div>
          )}

          {warnings.map((w) => (
            <Alert key={w} tone="warn">
              {w}
            </Alert>
          ))}

          <Field label="Confidence" htmlFor="run-conf" hint="Detections below this score are not kept.">
            <Input
              id="run-conf"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={conf}
              onChange={(e) => setConf(e.target.value)}
              className="max-w-32"
            />
          </Field>

          {(hasPhotos || hasMaps) && (
            <Disclosure>
              <div className="flex flex-col gap-4">
                {hasPhotos && (
                  <div className="flex flex-col gap-2">
                    <Checkbox
                      label="Split large photos into tiles"
                      checked={tiling}
                      onChange={(e) => setTiling(e.target.checked)}
                    />
                    {tiling && (
                      <Field label="Tile size (px)" htmlFor="run-tile">
                        <Input
                          id="run-tile"
                          type="number"
                          min="256"
                          max="4096"
                          step="64"
                          value={tileSize}
                          onChange={(e) => setTileSize(e.target.value)}
                          className="max-w-32"
                        />
                      </Field>
                    )}
                  </div>
                )}
                {hasMaps && (
                  <Field
                    label="Map ground size for the model (cm / px)"
                    htmlFor="run-gsd"
                    hint="Maps are always read in windows. Leave empty to use the size the model was trained at."
                  >
                    <Input
                      id="run-gsd"
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={gsd}
                      placeholder={model?.train_gsd_cm ? String(model.train_gsd_cm) : "map's own"}
                      onChange={(e) => setGsd(e.target.value)}
                      className="max-w-32"
                    />
                  </Field>
                )}
              </div>
            </Disclosure>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function SourceRow({
  source,
  checked,
  onToggle,
}: {
  source: RunSource;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-3 border-t border-line px-3 py-2 first:border-t-0">
      <Checkbox
        checked={checked}
        onChange={onToggle}
        label={<span className="text-ink">{source.label}</span>}
      />
      <Pill size="sm">{source.kind === "map" ? "Map" : "Photos"}</Pill>
      <span className="ml-auto flex gap-3 text-xs tabular-nums text-muted">
        <span>{source.detail}</span>
        <span className={source.capturedOn ? undefined : "text-dim"}>
          {source.capturedOn ?? "date not set"}
        </span>
      </span>
    </li>
  );
}
