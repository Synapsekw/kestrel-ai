import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AnalyticsScreen } from "./AnalyticsScreen";
import { fakeClient, type FakeRoute } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import {
  PHOTO_SOURCE_ID,
  PROJECT_ID,
  areaAnalytics,
  mapSource,
  mapSourceAnalytics,
  photoBatches,
  photoSource,
  timeline,
  verifiedTimeline,
} from "@/analytics/fixtures";
import { PHOTO_CAPTION } from "@/analytics/format";

const route = `/p/${PROJECT_ID}/analytics`;
const path = "/p/:projectId/analytics";

const photoAnalytics = {
  source: photoSource,
  unit: "detections",
  image_count: 3299,
  run: photoBatches.batches[0].run,
  classes: photoBatches.batches[0].classes,
  review: { total: 40, reviewed: 12 },
};

function routes(overrides: FakeRoute[] = []): FakeRoute[] {
  return [
    ...overrides,
    {
      method: "GET",
      path: /survey-timeline/,
      body: (req) => (req.url.includes("verified_only=true") ? verifiedTimeline : timeline),
    },
    {
      method: "GET",
      path: /analytics\/sources\//,
      body: (req) => (req.url.includes(PHOTO_SOURCE_ID) ? photoAnalytics : mapSourceAnalytics),
    },
    { method: "GET", path: /analytics\/areas/, body: areaAnalytics },
    { method: "GET", path: /analytics\/photo-batches/, body: photoBatches },
    { method: "GET", path: /\/sources$/, body: { items: [photoSource, mapSource], next_cursor: null } },
  ];
}

beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

describe("AnalyticsScreen", () => {
  it("has the four sections", async () => {
    const { api } = fakeClient(routes());
    renderWithProviders(<AnalyticsScreen />, { api, route, path });
    expect(await screen.findByRole("heading", { name: "Surveys" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Per source" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Per site area" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: PHOTO_CAPTION })).toBeInTheDocument();
  });

  it("shows each survey as total (verified)", async () => {
    const { api } = fakeClient(routes());
    renderWithProviders(<AnalyticsScreen />, { api, route, path });
    const table = await screen.findByTestId("surveys-table");
    expect(within(table).getByText(/12 \(9 verified\)/)).toBeInTheDocument();
  });

  it("the verified-only switch refetches the surveys and changes the numbers", async () => {
    const { api, requests } = fakeClient(routes());
    renderWithProviders(<AnalyticsScreen />, { api, route, path });
    await screen.findByTestId("surveys-table");
    const source = await screen.findByTestId("source-table");
    expect(within(source).getByText("42 (30 verified)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Verified only" }));

    await waitFor(() => expect(requests.some((r) => r.url.includes("verified_only=true"))).toBe(true));
    await waitFor(() => expect(within(source).queryByText("42 (30 verified)")).not.toBeInTheDocument());
    expect(within(source).getByText("30")).toBeInTheDocument();
    const surveys = screen.getByTestId("surveys-table");
    expect(within(surveys).queryByText(/12 \(9 verified\)/)).not.toBeInTheDocument();
    expect(within(surveys).getByText("9")).toBeInTheDocument();
  });

  it("describes the chosen run of a source and its review progress", async () => {
    const { api } = fakeClient(routes());
    renderWithProviders(<AnalyticsScreen />, { api, route, path });
    const section = await screen.findByTestId("source-section");
    await within(section).findByText("412 of 530 reviewed", { exact: false });
    expect(within(section).getByText(/machinery-v3/)).toBeInTheDocument();
    expect(within(section).getByText(/objects on the map/i)).toBeInTheDocument();
  });

  it("switches to a photo source and calls its numbers detections", async () => {
    const { api, requests } = fakeClient(routes());
    renderWithProviders(<AnalyticsScreen />, { api, route, path });
    const select = await screen.findByLabelText("Source");
    await within(screen.getByTestId("source-section")).findByText(/412 of 530/);
    fireEvent.change(select, { target: { value: PHOTO_SOURCE_ID } });
    await waitFor(() =>
      expect(requests.some((r) => r.url.endsWith(`/analytics/sources/${PHOTO_SOURCE_ID}`))).toBe(true),
    );
    const section = screen.getByTestId("source-section");
    expect(await within(section).findByText(/12 of 40 reviewed/)).toBeInTheDocument();
    expect(within(section).getByText(/detections across 3299 photos/i)).toBeInTheDocument();
  });

  it("tables the site areas for the chosen survey and marks partial cover", async () => {
    const { api } = fakeClient(routes());
    renderWithProviders(<AnalyticsScreen />, { api, route, path });
    const table = await screen.findByTestId("area-table");
    // Newest survey first: May, where the batching plant is not on the map.
    expect(within(table).getByText("7 (6 verified)")).toBeInTheDocument();
    expect(within(table).getByText("not on this map")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Survey"), { target: { value: areaAnalytics.surveys[0].map_id } });
    expect(await within(table).findByText("partly covered")).toBeInTheDocument();
    expect(within(table).getByText("5 (5 verified)")).toBeInTheDocument();
    expect(screen.getByTestId("area-trend")).toBeInTheDocument();
  });

  it("lists photo batches as detections", async () => {
    const { api } = fakeClient(routes());
    renderWithProviders(<AnalyticsScreen />, { api, route, path });
    const section = await screen.findByTestId("photo-section");
    expect(await within(section).findByText("Flight 15 Apr")).toBeInTheDocument();
    expect(within(section).getByText("31 (12 verified)")).toBeInTheDocument();
  });

  it("explains empty sections instead of showing blank tables", async () => {
    const { api } = fakeClient(
      routes([
        { method: "GET", path: /survey-timeline/, body: { basis: null, classes: [], surveys: [] } },
        { method: "GET", path: /analytics\/areas/, body: { areas: [], surveys: [] } },
        { method: "GET", path: /analytics\/photo-batches/, body: { batches: [] } },
        { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
      ]),
    );
    renderWithProviders(<AnalyticsScreen />, { api, route, path });
    expect(await screen.findByText("No surveys yet")).toBeInTheDocument();
    expect(await screen.findByText("No sources yet")).toBeInTheDocument();
    expect(await screen.findByText("No site areas yet")).toBeInTheDocument();
    expect(await screen.findByText("No photo batches yet")).toBeInTheDocument();
  });
});
