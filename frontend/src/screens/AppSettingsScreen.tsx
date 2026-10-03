import { Link } from "react-router-dom";
import { AppearanceSection } from "@/settings/AppearanceSection";
import { ProvidersSection } from "@/settings/ProvidersSection";
import { BrandsSection } from "@/settings/brands/BrandsSection";
import { buttonClass } from "@/ui";

/** Settings that belong to the app rather than to one project; reachable with no project open. */
export function AppSettingsScreen() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">App settings</h1>
        <p className="text-sm text-muted">
          Settings for this computer, used by all projects: appearance, provider keys and report brands.
        </p>
      </div>
      <div className="divide-y divide-line">
        <AppearanceSection />
        <ProvidersSection />
        <BrandsSection />
      </div>
      <div className="border-t border-line pt-4">
        <Link to="/about" className={buttonClass("secondary", "sm")}>
          About Kestrel AI
        </Link>
      </div>
    </section>
  );
}
