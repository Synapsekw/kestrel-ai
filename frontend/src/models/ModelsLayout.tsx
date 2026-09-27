import { Outlet } from "react-router-dom";
import { Tabs } from "@/ui";

const TABS = [
  { id: "library", to: "/models/library", label: "Library" },
  { id: "datasets", to: "/models/datasets", label: "Datasets" },
  { id: "training", to: "/models/training", label: "Training" },
];

/** F §12 / D8: the app-level Models section. Sub-screens title themselves with h2. */
export function ModelsLayout() {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Models</h1>
        <p className="text-sm text-muted">
          Every model on this computer, the datasets built from your projects, and training.
        </p>
      </header>
      <Tabs asLinks label="Models sections" items={TABS} />
      <Outlet />
    </section>
  );
}
