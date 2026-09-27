/* eslint-disable react-refresh/only-export-components --
   the module store is exported next to the dialog that writes it, for BatchDetectWatch to read; not a fast-refresh boundary. */
import { useEffect, useId, useMemo, useState } from "react";
import { create } from "zustand";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { providerLabel, useProviders } from "@/api/providers";
import { DEFAULT_TILING } from "@/api/queryRuns";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { useJobsStore } from "@/store/jobs";
import { Button, Checkbox, Dialog, Disclosure, Field, Input, Select, Slider, Switch, toast } from "@/ui";
import { useAiStore } from "./aiStore";
import { detectBatch, type DetectBatchRequest } from "./api";
import { menuSubtitle, readConf, readLastModel } from "./models";
import { stopTabPropagation } from "./overlayKeys";
import { useDetectModels } from "./useDetectModels";

export type BatchScope = DetectBatchRequest["scope"];
export interface BatchDetectDialogProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  scope: BatchScope;
  scopeLabel: string;
  scopeCount: number | null;
}

/** Job ids this launcher started; BatchDetectWatch reports their outcome. */
export const useBatchRuns = create<{ ids: string[]; add: (id: string) => void; drop: (id: string) => void }>(
  (set) => ({
    ids: [],
    add: (id) => set((s) => (s.ids.includes(id) ? s : { ids: [...s.ids, id] })),
    drop: (id) => set((s) => ({ ids: s.ids.filter((x) => x !== id) })),
  }),
);

const count = (n: number | null) =>
  n === null ? "the filtered images" : `${n} ${n === 1 ? "image" : "images"}`;

/** Spec §11.3; `/query` lands here as `images?batch=1` (FW wires the route and the scope). */
export function BatchDetectDialog({
  projectId,
  open,
  onClose,
  scope,
  scopeLabel,
  scopeCount,
}: BatchDetectDialogProps) {
  const api = useApi();
  const { all } = useProjectTypes(projectId);
  const { models, loading } = useDetectModels(projectId);
  const { providers } = useProviders();
  const keyed = useMemo(() => providers.filter((p) => p.has_key), [providers]);
  const [modelId, setModelId] = useState<string | null>(() => readLastModel(projectId));
  // Re-seed on a project change (M7): the component can outlive one project.
  const [modelFor, setModelFor] = useState(projectId);
  if (modelFor !== projectId) {
    setModelFor(projectId);
    setModelId(readLastModel(projectId));
  }
  const chosen = models.find((m) => m.id === modelId) ?? models[0] ?? null;
  const [conf, setConf] = useState(0.25);
  const [tiling, setTiling] = useState(DEFAULT_TILING.enabled);
  const [cloud, setCloud] = useState(false);
  const [provider, setProvider] = useState<string>("");
  const [query, setQuery] = useState("");
  const [costOk, setCostOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = { model: useId(), provider: useId(), query: useId() };
  // Adjust state during render (React's documented alternative to an effect that only mirrors a
  // derived value; ModelMenu.tsx uses the same pattern) rather than `useEffect` + `setState`, which
  // the repo's `set-state-in-effect` lint rule refuses.
  const [confForModel, setConfForModel] = useState<string | null>(null);
  if (chosen && confForModel !== chosen.id) {
    setConfForModel(chosen.id);
    setConf(readConf(chosen.id));
  }
  const [providerSeeded, setProviderSeeded] = useState(false);
  if (!providerSeeded && keyed.length > 0) {
    setProviderSeeded(true);
    setProvider(keyed[0].name);
  }

  const p = keyed.find((x) => x.name === provider) ?? null;
  const cost = p && scopeCount !== null ? (p.cost_per_request * scopeCount).toFixed(2) : null;
  // The tick acknowledges one amount on one account (I3): a new provider, amount or opening of the
  // dialog asks again.
  const costKey = `${provider}|${cost}|${open}`;
  const [costAckFor, setCostAckFor] = useState(costKey);
  if (costAckFor !== costKey) {
    setCostAckFor(costKey);
    setCostOk(false);
  }
  // FA's canvas keys stay quiet behind this dialog (M8).
  useEffect(() => {
    if (!open) return;
    useAiStore.getState().setBatchOpen(true);
    return () => useAiStore.getState().setBatchOpen(false);
  }, [open]);
  const ready = cloud ? p !== null && query.trim().length > 0 && costOk : chosen !== null;

  async function start() {
    const body: DetectBatchRequest = cloud
      ? {
          kind: "cloud_provider",
          provider: p!.name,
          query: query.trim(),
          conf,
          tiling: { ...DEFAULT_TILING, enabled: tiling },
          scope,
        }
      : {
          kind: "local_model",
          model_id: chosen!.id,
          conf,
          tiling: { ...DEFAULT_TILING, enabled: tiling },
          scope,
        };
    setBusy(true);
    try {
      const r = await detectBatch(api, projectId, body);
      useJobsStore.getState().upsert(r.job);
      useBatchRuns.getState().add(r.job.id);
      toast("info", `Detection started on ${count(scopeCount)}`);
      onClose();
    } catch (e) {
      toast("danger", `Could not start detection: ${messageOf(e, "unknown error")}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    // Tab from FA's registered key rows preventDefaults at window level (Task 5 review); stop it
    // here so focus still moves inside this dialog (mirrors BulkConfirm/ModelMenu).
    <div className="contents" onKeyDown={stopTabPropagation}>
      <Dialog
        open={open}
        onClose={onClose}
        title="Detect on many images"
        description={scopeLabel}
        testId="batch-detect"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!ready || busy} loading={busy} onClick={() => void start()}>
              Detect on {count(scopeCount)}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {!cloud ? (
            <Field
              label="Library model"
              htmlFor={ids.model}
              hint={
                chosen
                  ? menuSubtitle(chosen, all)
                  : loading
                    ? "Loading models…"
                    : "No library model reaches this project's types."
              }
            >
              <Select
                id={ids.model}
                value={chosen?.id ?? ""}
                onChange={(e) => setModelId(e.target.value)}
                disabled={models.length === 0}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Slider
            label="Confidence"
            min={0.05}
            max={0.95}
            step={0.05}
            value={conf}
            onChange={setConf}
            format={(v) => `${Math.round(v * 100)}%`}
            showValue
          />
          <Switch checked={tiling} onChange={setTiling} label="Tile large images" />
          <Disclosure label="More">
            <div className="flex flex-col gap-3 pt-2">
              <Switch
                checked={cloud}
                onChange={setCloud}
                label="Use a cloud provider instead"
                disabled={keyed.length === 0}
              />
              {cloud ? (
                <>
                  <Field label="Provider" htmlFor={ids.provider}>
                    <Select id={ids.provider} value={provider} onChange={(e) => setProvider(e.target.value)}>
                      {keyed.map((x) => (
                        <option key={x.name} value={x.name}>
                          {providerLabel(x.name)} · {x.model_name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="What to look for" htmlFor={ids.query}>
                    <Input
                      id={ids.query}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="cracks and spalling in concrete"
                    />
                  </Field>
                  <Checkbox
                    checked={costOk}
                    onChange={(e) => setCostOk(e.target.checked)}
                    label={
                      cost !== null
                        ? `I accept about $${cost} of charges to my ${providerLabel(provider)} account`
                        : "I accept charges; the cost depends on the filter"
                    }
                  />
                </>
              ) : null}
            </div>
          </Disclosure>
        </div>
      </Dialog>
    </div>
  );
}
