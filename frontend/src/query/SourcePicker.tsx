import { Link } from "react-router-dom";
import type { Model, Provider, ProviderName } from "@contract/client";
import { providerLabel } from "@/api/providers";
import { kindLabel } from "@/models/modelLabels";
import type { QueryForm } from "./queryModel";

interface Props {
  projectId: string;
  form: QueryForm;
  onChange: (patch: Partial<QueryForm>) => void;
  models: Model[];
  modelsUnavailable: boolean;
  modelsLoading: boolean;
  modelsError: string | null;
  providers: Provider[];
  providersUnavailable: boolean;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm disabled:opacity-50";
const label = "flex flex-col gap-1 text-xs text-slate-400";

export function SourcePicker({
  projectId,
  form,
  onChange,
  models,
  modelsUnavailable,
  modelsLoading,
  modelsError,
  providers,
  providersUnavailable,
}: Props) {
  const chosen = providers.find((p) => p.name === form.provider);
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-medium">Source</legend>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="kind"
            aria-label="Local model"
            checked={form.kind === "local_model"}
            onChange={() => onChange({ kind: "local_model" })}
          />
          Local model
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="kind"
            aria-label="Cloud provider"
            checked={form.kind === "cloud_provider"}
            onChange={() => onChange({ kind: "cloud_provider" })}
          />
          Cloud provider
        </label>
      </div>
      {form.kind === "local_model" ? (
        <label className={label}>
          Model
          <select
            aria-label="Model"
            value={form.modelId}
            onChange={(e) => onChange({ modelId: e.target.value })}
            disabled={modelsUnavailable}
            className={input}
          >
            <option value="">Choose a model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({kindLabel(m.kind)})
              </option>
            ))}
          </select>
          {modelsUnavailable && <span role="note">The model registry is not available yet.</span>}
          {modelsError && (
            <span role="alert" className="text-red-300">
              The models could not be loaded: {modelsError}
            </span>
          )}
          {!modelsLoading && !modelsUnavailable && !modelsError && models.length === 0 && (
            <span>
              No models yet.{" "}
              <Link to={`/p/${projectId}/models`} className="text-orange-300 hover:underline">
                Add a starter model
              </Link>{" "}
              to get started.
            </span>
          )}
        </label>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className={label}>
            Provider
            <select
              aria-label="Provider"
              value={form.provider}
              onChange={(e) => onChange({ provider: e.target.value as ProviderName })}
              disabled={providersUnavailable}
              className={input}
            >
              {providers.map((p) => (
                <option key={p.name} value={p.name} disabled={!p.has_key}>
                  {providerLabel(p.name)} ({p.model_name}){p.has_key ? "" : " (no key stored)"}
                </option>
              ))}
            </select>
            {providersUnavailable && <span role="note">Cloud providers are not available yet.</span>}
            {chosen && !chosen.has_key && (
              <span role="note">
                No API key stored for {providerLabel(chosen.name)}.{" "}
                <Link to="/settings" className="text-orange-300 hover:underline">
                  Add the key in App settings
                </Link>
              </span>
            )}
          </label>
          <label className={label}>
            Query
            <input
              aria-label="Query"
              value={form.query}
              onChange={(e) => onChange({ query: e.target.value })}
              placeholder="dump trucks"
              className={input}
            />
            <span>Free text describing what to find; answers are constrained to the project classes.</span>
          </label>
        </div>
      )}
    </fieldset>
  );
}
