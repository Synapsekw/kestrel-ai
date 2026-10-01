import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { exampleJob, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { exampleActivity } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import type { SeverityRow } from "./kpis";
import { StatusPane } from "./StatusPane";

const rows: SeverityRow[] = [
  { key: "4", name: "Critical", colour: null, count: 5, fraction: 1, href: "/x?severity=4" },
  { key: "1", name: "Low", colour: null, count: 2, fraction: 0.4, href: "/x?severity=1" },
];

const activity = Array.from({ length: 8 }, (_, i) => ({
  ...exampleActivity[0],
  id: `a${i}`,
  summary: `event ${i}`,
}));

function renderPane(showBars = true) {
  renderWithProviders(
    <StatusPane
      projectId={PROJECT_ID}
      rows={rows}
      activity={activity}
      activityFailed={false}
      showBars={showBars}
    />,
    { api: fakeClient([]).api },
  );
  return screen.getByRole("region", { name: "Status" });
}

describe("StatusPane", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("shows the three newest activity lines and All activity, and scrolls rather than clips", () => {
    const pane = renderPane();
    expect(
      within(pane)
        .getAllByRole("listitem")
        .filter((li) => /event/.test(li.textContent ?? "")),
    ).toHaveLength(3);
    expect(within(pane).getByText("event 0")).toBeInTheDocument();
    expect(within(pane).queryByText("event 3")).not.toBeInTheDocument();
    expect(within(pane).getByRole("link", { name: /All activity/ })).toBeInTheDocument();
    expect(pane).toHaveClass("overflow-y-auto");
    expect(pane).not.toHaveClass("overflow-hidden");
  });

  it("shows the severity bars only when asked", () => {
    renderPane(false);
    expect(screen.queryByRole("link", { name: "Critical: 5 open" })).not.toBeInTheDocument();
  });

  it("with the bars on, each level links to its findings", () => {
    renderPane(true);
    expect(screen.getByRole("link", { name: "Critical: 5 open" })).toHaveAttribute("href", "/x?severity=4");
  });

  it("lists active jobs only: no Last finished card in the pane", () => {
    useJobsStore.getState().upsertMany([
      { ...runningJob, project_id: PROJECT_ID },
      {
        ...exampleJob,
        id: "j-done",
        project_id: PROJECT_ID,
        state: "succeeded",
        progress: 1,
        finished_at: "2026-09-17T12:00:00Z",
      },
    ]);
    const pane = renderPane();
    expect(within(pane).getByText("Running")).toBeInTheDocument();
    expect(within(pane).queryByText("Last finished")).not.toBeInTheDocument();
  });
});
