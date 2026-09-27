import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, PROJECT_ID, runningJob, type FakeRoute } from "@/test/fixtures";
import {
  baseRoutes,
  emptyOverview,
  exampleActivity,
  exampleFinding,
  fullOverview,
} from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { OverviewScreen } from "./OverviewScreen";

vi.mock("./MapHero", () => ({
  MapHero: ({ hasData }: { hasData: boolean }) => (
    <div data-testid="map-hero" data-has-data={String(hasData)} />
  ),
}));
vi.mock("@/app/effects", async (orig) => ({
  ...(await orig<object>()),
  runAutoProbe: vi.fn(async () => null),
}));
// Count-up shows the final value at once under reduced motion (F §4.2).
vi.mock("@/ui/motion", async (orig) => ({ ...(await orig<object>()), useReducedMotion: () => true }));

function renderOverview(overview: object | FakeRoute, extra: FakeRoute[] = []) {
  const overviewRoute: FakeRoute =
    "method" in overview ? (overview as FakeRoute) : { method: "GET", path: /\/overview$/, body: overview };
  const { api, requests } = fakeClient(
    baseRoutes([
      overviewRoute,
      ...extra,
      { method: "GET", path: /\/findings$/, body: { items: [exampleFinding], next_cursor: null } },
      { method: "GET", path: /\/activity$/, body: { items: exampleActivity, next_cursor: null } },
      { method: "GET", path: /\/jobs$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/adoption$/, body: { pending: 0, adopted: 0, missing: [], job_id: null } },
    ]),
  );
  renderWithProviders(<OverviewScreen />, {
    api,
    route: `/p/${PROJECT_ID}/overview`,
    path: "/p/:projectId/overview",
  });
  return requests;
}

const overviewReads = (requests: { url: string }[]) => requests.filter((r) => r.url.includes("/overview"));

describe("OverviewScreen", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {} });
    useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 });
  });

  it("shows the full dashboard from one overview read and bounded lists", async () => {
    const requests = renderOverview(fullOverview);
    expect(await screen.findByText("Open findings")).toBeInTheDocument();
    // F13: StatTile renders the number twice (count-up + screen-reader copy).
    expect(screen.getByText("Open findings").closest("[data-glass]")).toHaveTextContent("47");
    expect(screen.getByText("Stockpile volume")).toBeInTheDocument();
    expect(screen.getByTestId("map-hero")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Critical: 5 open" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/findings?status=open&severity=4`,
    );
    expect(screen.getByRole("link", { name: "View all 89 findings" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/findings?sort=-updated_at`,
    );
    const recent = screen.getByRole("list", { name: "Recent findings" });
    expect(within(recent).getByText("F-0217")).toBeInTheDocument();
    expect(screen.getByText("9 detections accepted as findings")).toBeInTheDocument();
    expect(overviewReads(requests)).toHaveLength(1);
    const findingsQ = new URL(requests.find((r) => /\/findings\?/.test(r.url))!.url, "http://fake")
      .searchParams;
    expect(findingsQ.get("limit")).toBe("5");
    expect(findingsQ.get("sort")).toBe("-updated_at");
    const activityQ = new URL(requests.find((r) => r.url.includes("/activity"))!.url, "http://fake")
      .searchParams;
    expect(activityQ.get("limit")).toBe("8");
    const jobsQ = new URL(requests.find((r) => /\/jobs\?/.test(r.url))!.url, "http://fake").searchParams;
    expect(jobsQ.get("limit")).toBe("10");
  });

  it("tells the map hero whether the project holds any data", async () => {
    renderOverview(fullOverview);
    expect(await screen.findByTestId("map-hero")).toHaveAttribute("data-has-data", "true");
  });

  it("keeps the last dashboard with a Retry notice when a refresh fails", async () => {
    let fail = false;
    const requests = renderOverview({
      method: "GET",
      path: /\/overview$/,
      status: () => (fail ? 500 : 200),
      body: () => (fail ? errorBody("internal", "database is locked") : fullOverview),
    });
    expect(await screen.findByText("Open findings")).toBeInTheDocument();
    fail = true;
    act(() => useChangesStore.getState().bumpFindings());
    expect(
      await screen.findByText("Couldn't refresh the overview", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Open findings")).toBeInTheDocument();
    expect(screen.getByTestId("map-hero")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("Couldn't refresh the overview")).toBeNull());
    expect(overviewReads(requests)).toHaveLength(3);
    expect(screen.getByText("Open findings")).toBeInTheDocument();
  });

  it("says what to do on an empty project", async () => {
    renderOverview(emptyOverview, [
      { method: "GET", path: /\/findings$/, body: { items: [], next_cursor: null } },
    ]);
    expect(await screen.findByText("Reviewed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No findings yet. Mark a defect in a workspace, or accept an AI detection of a defect type.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Nothing is running.")).toBeInTheDocument();
    expect(screen.getByTestId("map-hero")).toHaveAttribute("data-has-data", "false");
  });

  it("lists this project's running job with its progress", async () => {
    useJobsStore.getState().upsert({ ...runningJob, project_id: PROJECT_ID, type: "infer", progress: 0.68 });
    renderOverview(fullOverview);
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "68");
  });

  it("shows the payload's banners with their action, and leaves model adoption to its own banner", async () => {
    renderOverview({
      ...fullOverview,
      banners: [
        {
          kind: "types_to_classify",
          tone: "info",
          message: "12 types came from your existing projects. Mark which are defects.",
          action: "/catalogue?origin=migrated",
        },
        {
          kind: "model_adoption",
          tone: "warn",
          message: "Models are moving into the library.",
          action: null,
        },
      ],
    });
    expect(await screen.findByText(/12 types came from your existing projects/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Catalogue" })).toHaveAttribute(
      "href",
      "/catalogue?origin=migrated",
    );
    expect(screen.queryByText("Models are moving into the library.")).not.toBeInTheDocument();
  });

  it("explains an upgrading project instead of an error", async () => {
    renderOverview({
      method: "GET",
      path: /\/overview$/,
      status: 409,
      body: errorBody("project_upgrading", "project is being upgraded", { job_id: "j1" }),
    });
    expect(await screen.findByText(/This project is being upgraded/)).toBeInTheDocument();
  });

  it("shows an error with Retry when the overview cannot be read, and Retry reads it again", async () => {
    let fail = true;
    const requests = renderOverview({
      method: "GET",
      path: /\/overview$/,
      status: () => (fail ? 500 : 200),
      body: () => (fail ? errorBody("internal", "database is locked") : fullOverview),
    });
    expect(await screen.findByText("database is locked")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Open findings")).toBeInTheDocument();
    expect(overviewReads(requests)).toHaveLength(2);
  });

  it("keeps the dashboard when the recent findings and activity reads fail", async () => {
    renderOverview(fullOverview, [
      { method: "GET", path: /\/findings$/, status: 500, body: errorBody("internal", "boom") },
      { method: "GET", path: /\/activity$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    expect(await screen.findByText("Open findings")).toBeInTheDocument();
    expect(screen.getByTestId("map-hero")).toBeInTheDocument();
    expect(screen.getByText("Recent findings could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("Activity could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText(/No findings yet/)).not.toBeInTheDocument();
  });

  it("re-reads once after a burst of finding changes", async () => {
    const requests = renderOverview(fullOverview);
    await screen.findByText("Open findings");
    // Fake timers: only the test moves the clock, so a stalled runner cannot split the burst.
    vi.useFakeTimers();
    try {
      act(() => {
        useChangesStore.getState().bumpFindings();
        useChangesStore.getState().bumpFindings();
        useChangesStore.getState().bumpFindings();
      });
      await act(() => vi.advanceTimersByTimeAsync(399));
      expect(overviewReads(requests)).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(overviewReads(requests)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
