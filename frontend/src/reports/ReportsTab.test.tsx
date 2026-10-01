import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { REPORT_ID } from "@/test/reportBuilderFixtures";
import { Route, Routes } from "react-router-dom";
import { ReportsTab } from "./ReportsTab";

vi.mock("@/exports/DataExportsPanel", () => ({
  DataExportsPanel: ({ projectId }: { projectId: string }) => (
    <section aria-label="Data exports">{projectId}</section>
  ),
}));
vi.mock("./ReportBuilder", () => ({
  ReportBuilder: ({ reportId }: { reportId: string }) => <p>builder {reportId}</p>,
}));

function renderAt(route: string) {
  const { api } = fakeClient([
    { method: "GET", path: /\/reports$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/report-templates$/, body: { items: [], next_cursor: null } },
  ]);
  renderWithProviders(
    <>
      <Routes>
        <Route path="/p/:projectId/reports" element={<ReportsTab />} />
        <Route path="/p/:projectId/reports/exports" element={<ReportsTab />} />
        <Route path="/p/:projectId/reports/:reportId" element={<ReportsTab />} />
      </Routes>
      <LocationProbe />
    </>,
    { api, route },
  );
}

describe("ReportsTab", () => {
  it("opens on Reports with the list", async () => {
    renderAt(`/p/${PROJECT_ID}/reports`);
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Reports" })).toBeChecked();
    expect(await screen.findByText("No reports yet")).toBeInTheDocument();
  });

  it("shows Data exports at reports/exports", () => {
    renderAt(`/p/${PROJECT_ID}/reports/exports`);
    expect(screen.getByRole("radio", { name: "Data exports" })).toBeChecked();
    expect(screen.getByRole("region", { name: "Data exports" })).toHaveTextContent(PROJECT_ID);
  });

  it("switches views by address", () => {
    renderAt(`/p/${PROJECT_ID}/reports`);
    fireEvent.click(screen.getByRole("radio", { name: "Data exports" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/reports/exports`);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Data exports" }), { key: "ArrowLeft" });
    expect(screen.getByTestId("location").textContent).toBe(`/p/${PROJECT_ID}/reports`);
  });

  it("opens a report in the builder without the switch", () => {
    renderAt(`/p/${PROJECT_ID}/reports/${REPORT_ID}`);
    expect(screen.getByText(`builder ${REPORT_ID}`)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Reports view" })).toBeNull();
  });
});
