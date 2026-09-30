import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, exampleImage, fakeClient, PROJECT_ID, runningJob, type FakeRoute } from "@/test/fixtures";
import {
  baseRoutes,
  cloudOnlyOverview,
  emptyOverview,
  exampleActivity,
  exampleFinding,
  exampleSite,
  fullOverview,
  imagesOnlyOverview,
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
vi.mock("./CloudPreview", () => ({
  CloudPreview: ({ variant }: { variant: string }) => <div data-testid={`cloud-${variant}`} />,
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
      ...extra,
      // Before `/overview$/`, so the more specific site read wins.
      { method: "GET", path: /\/overview\/site$/, body: exampleSite },
      overviewRoute,
      { method: "GET", path: /\/pointclouds$/, body: { items: [] } },
      { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null } },
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

const overviewReads = (requests: { url: string }[]) => requests.filter((r) => /\/overview(\?|$)/.test(r.url));

const imagesRoute: FakeRoute = {
  method: "GET",
  path: /\/images$/,
  body: { items: [exampleImage], next_cursor: null },
};

const panes = () => [...document.querySelectorAll("[data-pane]")].map((e) => e.getAttribute("data-pane"));

describe("OverviewScreen", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {} });
    useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 });
  });

  it("shows the full dashboard from one overview read and bounded lists", async () => {
    const requests = renderOverview(fullOverview);
    expect(await screen.findByText("Open findings")).toBeInTheDocument();
    // The header strip carries the figures: the value, its link and the danger tone.
    const open = screen.getByText("Open findings").closest("a")!;
    expect(open).toHaveTextContent("47");
    expect(open).toHaveAttribute("href", `/p/${PROJECT_ID}/findings?status=open`);
    const critical = within(screen.getByRole("heading", { name: "Ahmadia" }).closest("[data-glass]")!)
      .getByText("Critical")
      .closest("a")!;
    expect(critical).toHaveTextContent("5");
    expect(critical.querySelector(".text-danger")).toHaveTextContent("5");
    expect(screen.getByText("Images")).toBeInTheDocument();
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

  it("a map hero without a map id falls through to the summary hero", async () => {
    renderOverview({ ...fullOverview, hero: { kind: "map", id: null } });
    await waitFor(() => expect(panes()).toContain("hero"));
    expect(await screen.findByRole("link", { name: /1,284 photos/ })).toBeInTheDocument();
    expect(screen.queryByTestId("map-hero")).not.toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "Add the first survey" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add data" })).toBeInTheDocument();
    expect(screen.queryByText("Reviewed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-hero")).not.toBeInTheDocument();
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

describe("Overview v2 layout", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {} });
    useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 });
  });

  it("everything: map hero, cloud tile, location, findings, imagery, status", async () => {
    renderOverview(fullOverview, [imagesRoute]);
    await waitFor(() => expect(panes()).toContain("location"));
    await waitFor(() => expect(panes()).toContain("imagery"));
    expect(panes()).toEqual(["header", "hero", "cloud", "location", "findings", "imagery", "status"]);
    // Settled, not the loading skeleton: the location is drawn from /overview/site and the header
    // carries its coordinates.
    expect(await screen.findAllByTestId("photo-point")).not.toHaveLength(0);
    expect(screen.getByText(/44\.8125° N 20\.4612° E/)).toBeInTheDocument();
    expect(screen.getByTestId("map-hero")).toBeInTheDocument();
    expect(screen.getByTestId("cloud-tile")).toBeInTheDocument();
  });

  it("no ortho: the cloud is the hero and there is no cloud tile", async () => {
    renderOverview(cloudOnlyOverview);
    await waitFor(() => expect(screen.getByTestId("cloud-hero")).toBeInTheDocument());
    expect(screen.queryByTestId("cloud-tile")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-hero")).not.toBeInTheDocument();
  });

  it("images only: the mosaic is the hero and there is no separate imagery pane", async () => {
    renderOverview(imagesOnlyOverview, [imagesRoute]);
    await waitFor(() => expect(panes()).toContain("hero"));
    expect(await screen.findByRole("region", { name: "Latest photos" })).toBeInTheDocument();
    expect(panes()).not.toContain("imagery");
  });

  it("an empty project is the first-data screen and nothing else", async () => {
    renderOverview(emptyOverview);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Add the first survey" })).toBeInTheDocument(),
    );
    expect(panes()).toEqual(["firstData"]);
  });

  it("a failed site read drops the location pane and keeps the page", async () => {
    renderOverview(fullOverview, [
      { method: "GET", path: /\/overview\/site$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    await waitFor(() => expect(panes()).toContain("hero"));
    await waitFor(() => expect(panes()).not.toContain("location"));
    expect(screen.queryByText(/Couldn't load the overview/)).not.toBeInTheDocument();
  });

  it("a failed latest-images read shows the summary hero, never an empty mosaic", async () => {
    renderOverview(imagesOnlyOverview, [
      { method: "GET", path: /\/images$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    expect(await screen.findByRole("region", { name: "Project data" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /1,284 photos/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Latest photos" })).not.toBeInTheDocument();
  });

  it("an empty latest-images page drops the imagery pane instead of leaving an empty grid", async () => {
    renderOverview(fullOverview);
    await waitFor(() => expect(panes()).toContain("location"));
    // The default /images route answers with no rows.
    await waitFor(() => expect(panes()).not.toContain("imagery"));
  });

  it("with images, the imagery pane shows", async () => {
    renderOverview(fullOverview, [imagesRoute]);
    await waitFor(() => expect(panes()).toContain("imagery"));
    expect(await screen.findByRole("heading", { name: /Latest imagery/ })).toBeInTheDocument();
  });

  it("a first import in progress (a source row, no images yet) is still the first-data screen", async () => {
    renderOverview({
      ...emptyOverview,
      data: { image_sets: 1, images: 0, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
    });
    await waitFor(() => expect(panes()).toEqual(["firstData"]));
  });

  it("a site without bounds has no location pane (SiteLocation draws nothing without them)", async () => {
    renderOverview(fullOverview, [
      { method: "GET", path: /\/overview\/site$/, body: { ...exampleSite, bounds_wgs84: null } },
    ]);
    await waitFor(() => expect(screen.getByText(/44\.8125° N 20\.4612° E/)).toBeInTheDocument());
    expect(panes()).not.toContain("location");
  });

  it("the location pane pins open findings only, not closed ones", async () => {
    const at = { lon: 20.4612, lat: 44.8125 };
    renderOverview(fullOverview, [
      {
        method: "GET",
        path: /\/findings$/,
        body: {
          items: [
            { ...exampleFinding, ...at, id: "f-open" },
            { ...exampleFinding, ...at, id: "f-closed", status: "closed" },
          ],
          next_cursor: null,
        },
      },
    ]);
    await waitFor(() => expect(screen.getAllByTestId("site-pin")).toHaveLength(1));
  });

  it("with no findings yet, the findings pane offers to run detection", async () => {
    renderOverview({ ...imagesOnlyOverview, findings: emptyOverview.findings }, [imagesRoute]);
    expect(await screen.findByText("No findings yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run detection" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/runs`,
    );
  });

  it("the grid takes the full width: no max-width cap", async () => {
    renderOverview(fullOverview);
    const grid = await screen.findByTestId("overview-grid");
    expect(grid.className).not.toMatch(/max-w-/);
    expect(grid.className).not.toMatch(/mx-auto/);
  });
});
