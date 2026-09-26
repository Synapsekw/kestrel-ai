import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Button, EmptyState, type IconName } from "@/ui";
import { AdoptionBanner } from "./AdoptionBanner";
import { useAddData } from "./addDataStore";

/** Interim Overview until the dashboard lands: the adoption notice and what to add first. */
export function InterimOverview() {
  const { projectId = "" } = useParams();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Overview</h1>
      <AdoptionBanner projectId={projectId} />
      <EmptyState
        icon="overview"
        title="Start by adding data"
        action={
          <Button variant="primary" icon="plus" onClick={() => useAddData.getState().show(null)}>
            Add data
          </Button>
        }
      >
        Photos, orthomosaics, elevation models and point clouds all live in this project. Add what you have,
        then open it from the tabs above.
      </EmptyState>
    </section>
  );
}

/** Interim Findings tab. */
export function InterimFindings() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Findings</h1>
      <EmptyState icon="findings" title="No findings yet">
        Findings are created in the Images, Maps and Point clouds workspaces, and are listed here.
      </EmptyState>
    </section>
  );
}

/** A section page whose screen has not landed yet. */
export function SectionPlaceholder({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      <EmptyState icon={icon} title={`${title} will appear here`}>
        {children}
      </EmptyState>
    </section>
  );
}
