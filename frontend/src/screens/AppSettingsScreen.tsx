import { ProvidersSection } from "@/settings/ProvidersSection";

/** Settings that belong to the app rather than to one project; reachable with no project open. */
export function AppSettingsScreen() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">App settings</h1>
        <p className="text-sm text-muted">Settings for this computer, used by all projects.</p>
      </div>
      <div className="divide-y divide-line">
        <ProvidersSection />
      </div>
    </section>
  );
}
