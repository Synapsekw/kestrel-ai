import { useLocation, useNavigate, useParams } from "react-router-dom";
import { DataExportsPanel } from "@/exports/DataExportsPanel";
import { EmptyState, Segmented, type SegmentedOption } from "@/ui";

type View = "reports" | "exports";

const VIEWS: SegmentedOption<View>[] = [
  { value: "reports", label: "Reports" },
  { value: "exports", label: "Data exports" },
];

/**
 * The Reports tab until the report builder lands (R7 replaces this file with `ReportsTab`):
 * the Reports | Data exports switch of reports spec §12, with Data exports at `reports/exports`.
 */
export function ReportsPlaceholder() {
  const { projectId = "" } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const view: View = /\/reports\/exports\/?$/.test(pathname) ? "exports" : "reports";
  const go = (v: View) => navigate(`/p/${projectId}/reports${v === "exports" ? "/exports" : ""}`);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <Segmented label="Reports view" options={VIEWS} value={view} onChange={go} className="self-start" />
      {view === "exports" ? (
        <DataExportsPanel projectId={projectId} />
      ) : (
        <EmptyState icon="report" title="No reports yet">
          Reports of this project&apos;s findings and measurements will be built here.
        </EmptyState>
      )}
    </section>
  );
}
