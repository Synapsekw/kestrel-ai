import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import type { Source } from "@contract/client";
import { exampleImagePage, exampleSource, fakeClient, MAP_ID, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useProjectKindStore } from "@/app/useProjectKind";
import type { RunSummary } from "@/api/review";
import { ReviewScreen } from "@/screens/ReviewScreen";

const photos: Source = {
  ...exampleSource,
  id: "s-photos",
  label: "Flight 15 Apr",
  captured_on: "2026-04-15",
};
const map: Source = {
  ...exampleSource,
  id: "s-map",
  kind: "map",
  label: "May survey",
  captured_on: "2026-05-02",
  map_id: MAP_ID,
  image_count: 0,
};

const summary = (over: Partial<RunSummary>): RunSummary => ({
  id: "run",
  kind: "map",
  source_id: "s-map",
  source_label: "May survey",
  model_id: "m1",
  model_name: "machinery-v3",
  conf: 0.25,
  job_state: "succeeded",
  pinned: false,
  counts: {},
  verified_counts: {},
  review: { total: 530, reviewed: 412 },
  created_at: "2026-05-03T10:00:00Z",
  ...over,
});

function renderScreen(routes: Parameters<typeof fakeClient>[0], route = `/p/${PROJECT_ID}/review`) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(
    <Routes>
      <Route path="/p/:projectId/review" element={<ReviewScreen />} />
      <Route path="/p/:projectId/maps/:mapId" element={<p data-testid="map-route">map route</p>} />
    </Routes>,
    { api, route },
  );
  return requests;
}

describe("Detection review", () => {
  beforeEach(() => {
    useProjectKindStore.setState({ byProject: {} });
    useProjectKindStore.getState().set(PROJECT_ID, "detect");
  });

  it("picks the newest survey first and reviews its pinned run on the map", async () => {
    renderScreen([
      { method: "GET", path: /\/sources$/, body: { items: [photos, map], next_cursor: null } },
      {
        method: "GET",
        path: /\/runs$/,
        body: {
          items: [
            summary({ id: "newest", created_at: "2026-05-04T00:00:00Z", review: { total: 10, reviewed: 0 } }),
            summary({ id: "pinned", pinned: true }),
          ],
          next_cursor: null,
        },
      },
    ]);
    expect(await screen.findByLabelText("Source")).toHaveValue("s-map");
    expect(await screen.findByText("412 of 530 reviewed")).toBeInTheDocument();
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review on the map" }));
    await waitFor(() => expect(screen.getByTestId("map-route")).toBeInTheDocument());
  });

  it("reviews a photo source's suggestions in the image queue", async () => {
    const requests = renderScreen(
      [
        { method: "GET", path: /\/sources$/, body: { items: [photos, map], next_cursor: null } },
        {
          method: "GET",
          path: /\/runs$/,
          body: {
            items: [
              summary({
                id: "q1",
                kind: "images",
                source_id: "s-photos",
                review: { total: 40, reviewed: 12 },
              }),
            ],
            next_cursor: null,
          },
        },
        { method: "GET", path: /\/images$/, body: exampleImagePage },
      ],
      `/p/${PROJECT_ID}/review?source=s-photos`,
    );
    expect(await screen.findByText("12 of 40 reviewed")).toBeInTheDocument();
    expect(await screen.findByText("81%")).toBeInTheDocument();
    const images = new URL(`http://x${requests.find((r) => r.url.includes("/images?"))?.url}`);
    expect(images.searchParams.get("source_id")).toBe("s-photos");
    expect(images.searchParams.get("has_pending")).toBe("true");
    const runs = new URL(`http://x${requests.find((r) => r.url.includes("/runs?"))?.url}`);
    expect(runs.searchParams.get("source_id")).toBe("s-photos");
    expect(screen.getByRole("button", { name: "Accept all at or above" })).toBeInTheDocument();
  });

  it("sends a source without a run to the Runs screen", async () => {
    renderScreen([
      { method: "GET", path: /\/sources$/, body: { items: [map], next_cursor: null } },
      { method: "GET", path: /\/runs$/, body: { items: [], next_cursor: null } },
    ]);
    expect(await screen.findByText("No run on this source yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run a model" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/runs?source=s-map`,
    );
  });

  it("explains an empty project", async () => {
    renderScreen([{ method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } }]);
    expect(await screen.findByText("Nothing to review yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add photos or a map" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/sources`,
    );
  });
});
