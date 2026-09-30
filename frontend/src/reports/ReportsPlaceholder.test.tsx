import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { exampleStats, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { ReportsPlaceholder } from "./ReportsPlaceholder";

function renderAt(route: string) {
  const { api } = fakeClient([
    { method: "GET", path: /\/stats$/, body: exampleStats },
    { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/jobs$/, body: { items: [], next_cursor: null } },
  ]);
  renderWithProviders(
    <>
      <ReportsPlaceholder />
      <LocationProbe />
    </>,
    { api, route, path: "/p/:projectId/*" },
  );
}

describe("ReportsPlaceholder (interim host until R7)", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("opens on Reports with the empty state", () => {
    renderAt(`/p/${PROJECT_ID}/reports`);
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Reports" })).toBeChecked();
    expect(screen.getByText("No reports yet")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Data exports" })).not.toBeInTheDocument();
  });

  it("shows the Data exports panel at reports/exports", () => {
    renderAt(`/p/${PROJECT_ID}/reports/exports`);
    expect(screen.getByRole("radio", { name: "Data exports" })).toBeChecked();
    expect(screen.getByRole("region", { name: "Data exports" })).toBeInTheDocument();
  });

  it("switches views by address, with the mouse or the keyboard", () => {
    renderAt(`/p/${PROJECT_ID}/reports`);
    fireEvent.click(screen.getByRole("radio", { name: "Data exports" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/reports/exports`);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Data exports" }), { key: "ArrowLeft" });
    expect(screen.getByTestId("location")).toHaveTextContent(new RegExp(`/p/${PROJECT_ID}/reports$`));
  });
});
