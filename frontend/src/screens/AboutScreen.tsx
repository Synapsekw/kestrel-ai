import { EmptyState } from "@/ui";

/**
 * About Kestrel AI: the app version and the licence notices of the components it ships (spec
 * 2026-09-23-point-clouds section 12). Lazy-loaded from routes.tsx. Foundation F0 lands it empty;
 * S1 unit A1 fills it from `src/about/notices.json`.
 */
export function AboutScreen() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">About Kestrel AI</h1>
        <p className="text-sm text-muted">
          The app&apos;s version and the licences of the components it uses.
        </p>
      </div>
      <EmptyState icon="info" title="Licence notices">
        The component list is not available in this build yet.
      </EmptyState>
    </section>
  );
}
