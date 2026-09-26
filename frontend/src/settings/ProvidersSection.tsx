import { useProviders } from "@/api/providers";
import { Alert, Skeleton } from "@/ui";
import { ProviderCard } from "./ProviderCard";

/** Spec section 6 screen 5: provider keys. Keys live in Windows Credential Manager, never in the project folder. */
export function ProvidersSection() {
  const { providers, loading, unavailable, error, replace } = useProviders();
  return (
    <section className="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Provider keys</h2>
        <p className="text-sm text-muted">
          OpenAI and Anthropic API keys are shared by every project on this machine: they are stored in
          Windows Credential Manager and are never written to a project folder or the logs. The model name,
          the rate limit and the cost per request feed the estimate on the Detect screen.
        </p>
      </div>
      {loading && (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
      {unavailable && (
        <p role="note" className="text-xs text-muted">
          Cloud providers are not available yet (they arrive with the inference backend).
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {providers.length > 0 && (
        <div className="divide-y divide-line rounded-lg border border-line bg-surface">
          {providers.map((p) => (
            <ProviderCard key={p.name} provider={p} onChanged={replace} />
          ))}
        </div>
      )}
    </section>
  );
}
