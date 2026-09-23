import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { RunSummary } from "@/api/runs";
import {
  CLASS_ID,
  exampleModel,
  exampleProject,
  exampleProviders,
  exampleSource,
  fakeClient,
  PROJECT_ID,
  SOURCE_ID,
  type FakeRoute,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { RunsScreen } from "./RunsScreen";

const mapRun: RunSummary = {
  id: "r-map",
  kind: "map",
  source_id: "map-source",
  source_label: "May survey",
  model_id: "m1",
  model_name: "machinery-v3",
  conf: 0.25,
  job_state: "succeeded",
  pinned: false,
  counts: { [CLASS_ID(1)]: 6, [CLASS_ID(4)]: 17 },
  verified_counts: { [CLASS_ID(1)]: 4 },
  review: { total: 530, reviewed: 412 },
  created_at: "2026-09-22T11:00:00Z",
};
const photoRun: RunSummary = {
  ...mapRun,
  id: "r-photos",
  kind: "images",
  source_id: SOURCE_ID,
  source_label: "Flight 15 Apr",
  job_state: "running",
  pinned: true,
  counts: {},
  verified_counts: {},
  review: { total: 0, reviewed: 0 },
};

function routes(extra: FakeRoute[] = []): FakeRoute[] {
  return [
    ...extra,
    { method: "GET", path: /\/runs$/, body: { items: [mapRun, photoRun], next_cursor: null } },
    { method: "GET", path: new RegExp(`/projects/${PROJECT_ID}$`), body: exampleProject },
    { method: "GET", path: /\/sources$/, body: { items: [exampleSource], next_cursor: null } },
    { method: "GET", path: /\/maps$/, body: { items: [] } },
    { method: "GET", path: /\/library\/models$/, body: { items: [exampleModel], next_cursor: null } },
    { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
  ];
}

const render = (api: ReturnType<typeof fakeClient>["api"], route = `/p/${PROJECT_ID}/runs`) =>
  renderWithProviders(<RunsScreen />, { api, route, path: "/p/:projectId/runs" });

describe("RunsScreen", () => {
  it("lists runs of both kinds with totals, verified counts and review progress", async () => {
    const { api } = fakeClient(routes());
    render(api);
    const row = (await screen.findByText("May survey")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Map · objects")).toBeInTheDocument();
    expect(within(row).getByText("6 (4)")).toBeInTheDocument();
    expect(within(row).getByText("17 (0)")).toBeInTheDocument();
    expect(within(row).getByText("412 of 530 reviewed")).toBeInTheDocument();
    expect(within(row).getByText("Done")).toBeInTheDocument();
    const photos = screen.getByText("Flight 15 Apr").closest("tr") as HTMLElement;
    expect(within(photos).getByText("Photos · detections")).toBeInTheDocument();
    expect(within(photos).getByText("Nothing found")).toBeInTheDocument();
    expect(within(photos).getByRole("button", { name: "Unpin the run on Flight 15 Apr" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("pins a run and reloads the list", async () => {
    const { api, requests } = fakeClient(
      routes([{ method: "PATCH", path: /\/runs\/r-map$/, body: { ...mapRun, pinned: true } }]),
    );
    render(api);
    fireEvent.click(await screen.findByRole("button", { name: "Pin the run on May survey" }));
    await waitFor(() =>
      expect(requests.filter((r) => r.method === "GET" && r.url.includes("/runs?")).length).toBe(2),
    );
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ pinned: true });
  });

  it("opens a new run with the source from the address picked", async () => {
    const { api } = fakeClient(routes());
    render(api, `/p/${PROJECT_ID}/runs?source=${SOURCE_ID}`);
    expect(await screen.findByRole("heading", { name: "New run" })).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "Ahmadia Construction Data" })).toBeChecked();
  });

  it("offers a first run when there are none", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/runs$/, body: { items: [], next_cursor: null } },
      ...routes(),
    ]);
    render(api);
    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
  });
});
