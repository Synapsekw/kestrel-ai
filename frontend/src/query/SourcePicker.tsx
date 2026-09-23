import { useId } from "react";
import { Link } from "react-router-dom";
import type { LibraryModel, Provider, ProviderName } from "@contract/client";
import { providerLabel } from "@/api/providers";
import { originLabel } from "@/library/modelLabels";
import { Alert, Field, Input, Segmented, Select, cx, focusRing } from "@/ui";
import type { QueryForm, QueryKind } from "./queryModel";

interface Props {
  /** Kept for callers; library models are app-wide, so the picker no longer needs it. */
  projectId?: string;
  form: QueryForm;
  onChange: (patch: Partial<QueryForm>) => void;
  models: LibraryModel[];
  modelsUnavailable: boolean;
  modelsLoading: boolean;
  modelsError: string | null;
  providers: Provider[];
  providersUnavailable: boolean;
}

const link = cx("rounded-sm font-medium text-accent hover:underline", focusRing);

const SOURCES: { value: QueryKind; label: string }[] = [
  { value: "local_model", label: "Library model" },
  { value: "cloud_provider", label: "Cloud provider" },
];

export function SourcePicker({
  form,
  onChange,
  models,
  modelsUnavailable,
  modelsLoading,
  modelsError,
  providers,
  providersUnavailable,
}: Props) {
  const id = useId();
  const chosen = providers.find((p) => p.name === form.provider);
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Source"
        options={SOURCES}
        value={form.kind}
        onChange={(kind) => onChange({ kind })}
        className="w-fit"
      />
      {form.kind === "local_model" ? (
        <div className="flex flex-col gap-2">
          <Field
            label="Model"
            htmlFor={`${id}-model`}
            hint={
              modelsUnavailable ? (
                <span role="note">The model library could not be opened. The Library screen shows why.</span>
              ) : !modelsLoading && !modelsError && models.length === 0 ? (
                <span>
                  No models yet.{" "}
                  <Link to="/library" className={link}>
                    Add a model to the library
                  </Link>{" "}
                  to get started.
                </span>
              ) : undefined
            }
            className="max-w-md"
          >
            <Select
              id={`${id}-model`}
              value={form.modelId}
              onChange={(e) => onChange({ modelId: e.target.value })}
              disabled={modelsUnavailable}
            >
              <option value="">Choose a model</option>
              <optgroup label="Models in your library">
                {models.map((m) => (
                  <option key={m.id} value={m.id} disabled={m.state === "unavailable"}>
                    {m.name} ({originLabel(m.origin)}){m.state === "unavailable" ? " (file missing)" : ""}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          {modelsError && (
            <Alert tone="danger" className="max-w-md">
              The models could not be loaded: {modelsError}
            </Alert>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Provider"
            htmlFor={`${id}-provider`}
            hint={
              providersUnavailable ? (
                <span role="note">Cloud providers are not available yet.</span>
              ) : chosen && !chosen.has_key ? (
                <span role="note">
                  No API key stored for {providerLabel(chosen.name)}.{" "}
                  <Link to="/settings" className={link}>
                    Add the key in App settings
                  </Link>
                </span>
              ) : undefined
            }
          >
            <Select
              id={`${id}-provider`}
              value={form.provider}
              onChange={(e) => onChange({ provider: e.target.value as ProviderName })}
              disabled={providersUnavailable}
            >
              {providers.map((p) => (
                <option key={p.name} value={p.name} disabled={!p.has_key}>
                  {providerLabel(p.name)} ({p.model_name}){p.has_key ? "" : " (no key stored)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Query"
            htmlFor={`${id}-query`}
            hint="Free text describing what to find; answers are constrained to the project classes."
          >
            <Input
              id={`${id}-query`}
              value={form.query}
              onChange={(e) => onChange({ query: e.target.value })}
              placeholder="dump trucks"
            />
          </Field>
        </div>
      )}
    </div>
  );
}
