import { useEffect, useState, type FormEvent } from "react";
import type { GeoMap, MapRun, ProviderName } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createMapRun, estimateMapRun, type MapRunEstimate } from "@/api/maps";
import { useProviders } from "@/api/providers";
import { useModels } from "@/models/useModels";
import { useJobsStore } from "@/store/jobs";
import { Button, Dialog, Field, Input, Segmented, Select } from "@/ui";
import { DEFAULT_MAP_RUN, defaultTargetGsd, validateRunForm } from "./runModel";

const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(n).replace(/,/g, " ");

export function NewRunDialog({
  projectId,
  geoMap,
  runs,
  onClose,
  onStarted,
}: {
  projectId: string;
  geoMap: GeoMap;
  runs: MapRun[];
  onClose: () => void;
  onStarted: (run: MapRun) => void;
}) {
  const api = useApi();
  const registry = useModels(projectId);
  const providers = useProviders();
  const [kind, setKind] = useState<"local_model" | "cloud_provider">("local_model");
  const [modelId, setModelId] = useState("");
  const [provider, setProvider] = useState<ProviderName>("anthropic");
  const [query, setQuery] = useState("");
  const [gsd, setGsd] = useState<string>("");
  const [conf, setConf] = useState(String(DEFAULT_MAP_RUN.conf));
  const [estimate, setEstimate] = useState<MapRunEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveModel = modelId || registry.models[0]?.id || "";
  // Re-prefills the GSD field when the detector or model changes, without fighting a value the
  // operator is mid-typing: a render-phase state adjustment (React's "reset state on a changed key"
  // pattern), not an effect, so it only fires on an actual key change.
  const gsdKey = `${kind}|${effectiveModel}`;
  const [gsdKeySeen, setGsdKeySeen] = useState("");
  if (gsdKey !== gsdKeySeen) {
    setGsdKeySeen(gsdKey);
    const d = defaultTargetGsd(runs, kind === "local_model" ? effectiveModel : null, geoMap.gsd_cm);
    setGsd(d ? String(d) : "");
  }

  const body = {
    map_id: geoMap.id,
    kind,
    ...(kind === "local_model"
      ? { model_id: effectiveModel }
      : { provider, query: query.trim() || undefined }),
    ...DEFAULT_MAP_RUN,
    conf: Number(conf),
    target_gsd_cm: gsd ? Number(gsd) : null,
  };
  const bodyKey = JSON.stringify(body);
  useEffect(() => {
    if (kind === "local_model" && !effectiveModel) return;
    let cancelled = false;
    estimateMapRun(api, projectId, JSON.parse(bodyKey))
      .then((e) => !cancelled && setEstimate(e))
      .catch(() => !cancelled && setEstimate(null));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, bodyKey, kind, effectiveModel]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const form = kind === "local_model" ? { kind, modelId: effectiveModel } : { kind, provider, query };
    const problem = validateRunForm(form, providers.providers);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const r = await createMapRun(api, projectId, body);
      useJobsStore.getState().upsert(r.job);
      onStarted(r.run);
    } catch (err) {
      setError(messageOf(err, "could not start the run"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      width="lg"
      title="Detect on this map"
      description="Runs the model across the whole map in windows and counts every class. Empty (nodata) areas are skipped."
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="detect" loading={busy}>
            Start detection
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          label="Detector"
          value={kind}
          onChange={setKind}
          options={[
            { value: "local_model", label: "Local model" },
            { value: "cloud_provider", label: "Cloud provider" },
          ]}
        />
        {kind === "local_model" ? (
          <Field label="Model" htmlFor="run-model">
            <Select id="run-model" value={effectiveModel} onChange={(e) => setModelId(e.target.value)}>
              {registry.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Provider" htmlFor="run-provider">
              <Select
                id="run-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderName)}
              >
                {providers.providers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
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
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Model trained at (cm / px)"
            htmlFor="run-gsd"
            hint={
              geoMap.gsd_cm
                ? `This map is ${geoMap.gsd_cm.toFixed(1)} cm / px. Different by over 15 % means the map is rescaled.`
                : "The map has no ground resolution; no rescaling."
            }
          >
            <Input
              id="run-gsd"
              type="number"
              step="0.1"
              min="0.1"
              value={gsd}
              onChange={(e) => setGsd(e.target.value)}
            />
          </Field>
          <Field label="Confidence" htmlFor="run-conf">
            <Input
              id="run-conf"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={conf}
              onChange={(e) => setConf(e.target.value)}
            />
          </Field>
        </div>
        {estimate && (
          <p className="text-sm text-muted" aria-live="polite">
            {`${fmt(estimate.requests)} windows to check · ${fmt(estimate.skipped_windows)} empty skipped${estimate.scale !== 1 ? ` · scaled ×${estimate.scale}` : ""}`}
            {estimate.estimated_cost > 0 && ` · about $${estimate.estimated_cost.toFixed(2)}`}
          </p>
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
