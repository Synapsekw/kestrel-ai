import { Alert, Button } from "@/ui";

/**
 * A reload of the model list failed while a list is shown (M1 deferred M7): say so, keep the list,
 * offer a retry. Sits above the build bar so it never covers the version notices at the top.
 */
export function ListReloadNotice({ error, onRetry }: { error: string; onRetry(): void }) {
  return (
    <div
      data-testid="model-list-error"
      className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-4"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-control bg-glass-solid shadow-elev-2">
        <Alert
          tone="danger"
          role="alert"
          title="The model list could not be refreshed."
          actions={
            <Button size="sm" icon="refresh" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          <p className="text-xs text-muted">{error}</p>
        </Alert>
      </div>
    </div>
  );
}
