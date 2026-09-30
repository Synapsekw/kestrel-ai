import { useLocation, useNavigate, useParams } from "react-router-dom";
import { DataExportsPanel } from "@/exports/DataExportsPanel";
import { Segmented, type SegmentedOption } from "@/ui";
import { ReportBuilder } from "./ReportBuilder";
import { ReportList } from "./ReportList";

type View = "reports" | "exports";

const VIEWS: SegmentedOption<View>[] = [
  { value: "reports", label: "Reports" },
  { value: "exports", label: "Data exports" },
];

/**
 * The Reports tab (spec §12): `reports` (the list), `reports/exports` (R8's Data exports panel) under a
 * Reports | Data exports switch, and `reports/:reportId`, the builder, which has its own top bar
 * (Ruling 11).
 */
export function ReportsTab() {
  const { projectId = "", reportId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (reportId) return <ReportBuilder key={reportId} projectId={projectId} reportId={reportId} />;

  const view: View = /\/reports\/exports\/?$/.test(pathname) ? "exports" : "reports";
  const go = (v: View) => navigate(`/p/${projectId}/reports${v === "exports" ? "/exports" : ""}`);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <Segmented label="Reports view" options={VIEWS} value={view} onChange={go} className="self-start" />
      {view === "exports" ? <DataExportsPanel projectId={projectId} /> : <ReportList projectId={projectId} />}
    </section>
  );
}
