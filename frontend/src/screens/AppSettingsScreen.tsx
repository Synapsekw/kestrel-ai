import { ProvidersSection } from "@/settings/ProvidersSection";

/** Settings that belong to the app rather than to one project; reachable with no project open. */
export function AppSettingsScreen() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">App settings</h1>
      <ProvidersSection />
    </section>
  );
}
