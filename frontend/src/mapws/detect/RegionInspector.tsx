import { useEffect, useState } from "react";
import type { GeoMap, Source } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { createRuns } from "@/api/runs";
import { fetchAllSources } from "@/api/sources";
import { pushLog } from "@/app/diagnostics";
import { useLibraryModels } from "@/library/useLibraryModels";
import { formatSurveyDate, useWorkspace, type InspectorBodyProps } from "@/mapws/w4host";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Field, Input, InspectorPane, InspectorSection, Select } from "@/ui";
import { useDetectStore } from "./detectStore";
import {
  NO_SOURCE,
  readLastModel,
  regionBody,
  regionError,
  regionMaps,
  regionProblem,
  regionSourceId,
  writeLastModel,
} from "./regionRun";

const LOAD_FAILED = "Could not load the orthomosaics of this site. Cancel and draw the box again.";
const NO_MODEL = "No detection model is ready. Add one in Models → Library, then run the region.";
const LIBRARY_UNAVAILABLE =
  "The model library is not available, so no model can run. Restart the app, then draw the box again.";
const libraryFailed = (message: string) =>
  `Could not load the model library (${message}). Cancel and draw the box again.`;

/** AI detect in a region (spec §5.1 D, §9.3): the drawn box, a model and a confidence → a map_detect run with scope=region. */
export function RegionInspector({ projectId, onClose }: InspectorBodyProps) {
  const api = useApi();
  const r = useWorkspace((s) => s.r);
  const select = useWorkspace((s) => s.select);
  const ring = useDetectStore((s) => s.regionDraft);
  const registry = useLibraryModels();
  // null until the one bounded read per draft (maps + sources) answers; "failed" when it could not.
  const [loaded, setLoaded] = useState<{ maps: GeoMap[]; sources: Source[] } | "failed" | null>(null);
  const [mapId, setMapId] = useState("");
  const [modelId, setModelId] = useState(() => readLastModel() ?? "");
  const [conf, setConf] = useState("0.25");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMaps(api, projectId), fetchAllSources(api, projectId)])
      .then(([maps, sources]) => !cancelled && setLoaded({ maps, sources }))
      .catch((err: unknown) => {
        pushLog(`load the maps for AI detect failed: ${messageOf(err, "could not load the maps")}`);
        if (!cancelled) setLoaded("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);

  const data = loaded && loaded !== "failed" ? loaded : null;
  const candidates = data ? regionMaps(data.maps, r) : [];
  const map = candidates.find((m) => m.id === mapId) ?? candidates[0] ?? null;
  const sourceId = data && map ? regionSourceId(data.sources, map.id) : null;
  const ready = registry.models.filter((m) => m.state === "ready");
  const model = ready.find((m) => m.id === modelId) ?? ready[0] ?? null;
  // Every refusal is decided here, before any request (Review Focus 5).
  const problem = (() => {
    if (loaded === "failed") return LOAD_FAILED;
    if (!data) return null;
    if (candidates.length > 0) {
      if (registry.loading) return null;
      // A failed read is not "no model": the advice to add one would be wrong.
      if (registry.unavailable) return LIBRARY_UNAVAILABLE;
      if (registry.error) return libraryFailed(registry.error);
      if (ready.length === 0) return NO_MODEL;
    }
    return regionProblem({ maps: candidates, r, model }) ?? (sourceId ? null : NO_SOURCE);
  })();
  const threshold = Number(conf);
  const validConf = conf.trim() !== "" && threshold >= 0 && threshold <= 1;

  const start = async () => {
    if (!ring || !map || !model || !sourceId || problem || !validConf || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createRuns(
        api,
        projectId,
        regionBody({
          sourceId,
          mapId: map.id,
          ring,
          modelId: model.id,
          conf: threshold,
          gsdCm: model.train_gsd_cm!,
        }),
      );
      const item = created.runs[0];
      useJobsStore.getState().upsert(item.job);
      useDetectStore.getState().addOutline({ runId: item.run_id, jobId: item.job.id, ring });
      useDetectStore.getState().setRegionDraft(null);
      writeLastModel(model.id);
      select({ kind: "run", id: item.run_id });
    } catch (err) {
      setError(regionError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <InspectorPane
      label="AI detect in a region"
      footer={
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => void start()}
            loading={busy}
            disabled={!ring || !map || !model || !sourceId || !!problem || !validConf}
          >
            Run
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              useDetectStore.getState().setRegionDraft(null);
              onClose();
            }}
          >
            Cancel
          </Button>
        </div>
      }
    >
      <InspectorSection key="where" title="Region">
        <div data-testid="region-inspector" className="flex flex-col gap-2">
          {!ring && <p className="text-sm text-muted">Drag a box on the map with the AI detect tool (D).</p>}
          {candidates.length > 1 && (
            <Field label="Orthomosaic" htmlFor="region-map">
              <Select id="region-map" dense value={map?.id ?? ""} onChange={(e) => setMapId(e.target.value)}>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {map && (
            <p className="text-xs text-muted">
              {map.name} · {formatSurveyDate(r)} · a region run never changes the survey's counts.
            </p>
          )}
        </div>
      </InspectorSection>
      <InspectorSection key="model" title="Model">
        <div className="flex flex-col gap-2">
          <Field label="Model" htmlFor="region-model">
            <Select
              id="region-model"
              dense
              value={model?.id ?? ""}
              onChange={(e) => setModelId(e.target.value)}
            >
              {ready.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Confidence"
            htmlFor="region-conf"
            error={validConf ? undefined : "Enter a number from 0 to 1."}
          >
            <Input
              id="region-conf"
              dense
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={conf}
              invalid={!validConf}
              onChange={(e) => setConf(e.target.value)}
            />
          </Field>
        </div>
      </InspectorSection>
      {(problem || error) && (
        <Alert key="problem" tone={error ? "danger" : "warn"}>
          {error ?? problem}
        </Alert>
      )}
    </InspectorPane>
  );
}
