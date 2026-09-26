import { EmptyState } from "@/ui";

/** The Reports tab until the report builder lands (spec 2026-09-26-foundation section 5.3). */
export function ReportsPlaceholder() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <EmptyState icon="report" title="No reports yet">
        Reports of this project&apos;s findings and measurements will be built here.
      </EmptyState>
    </section>
  );
}
