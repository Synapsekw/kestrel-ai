import { useProviders } from "@/api/providers";
import { ProviderCard } from "./ProviderCard";

/** Spec section 6 screen 5: provider keys. Keys live in Windows Credential Manager, never in the project folder. */
export function ProvidersSection() {
  const { providers, loading, unavailable, error, replace } = useProviders();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Provider keys</h2>
      <p className="text-sm text-slate-400">
        OpenAI and Anthropic API keys are shared by every project on this machine: they are stored in Windows
        Credential Manager and are never written to a project folder or the logs. The model name, the rate
        limit and the cost per request feed the query screen&apos;s estimate.
      </p>
      {loading && <p className="text-xs text-slate-400">Loading providers…</p>}
      {unavailable && (
        <p role="note" className="text-xs text-slate-400">
          Cloud providers are not available yet (they arrive with the inference backend).
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      {providers.map((p) => (
        <ProviderCard key={p.name} provider={p} onChanged={replace} />
      ))}
    </section>
  );
}
