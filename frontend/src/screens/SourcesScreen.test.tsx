import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { GeoMap, Source } from "@contract/client";
import {
  errorBody,
  exampleGeoMap,
  exampleProject,
  exampleSource,
  fakeClient,
  PROJECT_ID,
  type FakeRoute,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { SourcesScreen } from "./SourcesScreen";

const route = `/p/${PROJECT_ID}/sources`;
const path = "/p/:projectId/sources";

const photoSource: Source = {
  ...exampleSource,
  id: "s-photos",
  label: "Flight 14 Sep",
  captured_on: "2026-09-14",
  image_count: 412,
};
const mapSource: Source = {
  ...exampleSource,
  id: "s-map",
  kind: "map",
  label: "May survey",
  captured_on: null,
  map_id: "m-linked",
  image_count: 0,
  folder: "D:\\Surveys\\may-ortho.tif",
};
const linkedMap: GeoMap = { ...exampleGeoMap, id: "m-linked", name: "may-ortho", width: 1200, height: 700 };
const legacyMap: GeoMap = { ...exampleGeoMap, id: "m-old", name: "Old ortho", captured_on: "2025-03-01" };

const runs = {
  items: [
    {
      id: "r1",
      kind: "map",
      source_id: "s-map",
      source_label: "May survey",
      model_id: "m1",
      model_name: "machinery-v3",
      conf: 0.25,
      job_state: "succeeded",
      pinned: false,
      counts: { a: 42, b: 17 },
      verified_counts: { a: 30 },
      review: { total: 59, reviewed: 34 },
      created_at: "2026-09-22T11:00:00Z",
    },
  ],
  next_cursor: null,
};

function routes(extra: FakeRoute[] = []): FakeRoute[] {
  return [
    ...extra,
    { method: "GET", path: /\/sources$/, body: { items: [photoSource, mapSource], next_cursor: null } },
    { method: "GET", path: /\/maps$/, body: { items: [linkedMap, legacyMap] } },
    { method: "GET", path: /\/runs$/, body: runs },
    { method: "GET", path: new RegExp(`/projects/${PROJECT_ID}$`), body: exampleProject },
  ];
}

const rowOf = async (name: string) => (await screen.findByText(name)).closest("tr") as HTMLElement;

beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

describe("SourcesScreen", () => {
  it("lists photos and maps in one list, newest survey first, a map without a source included", async () => {
    const { api } = fakeClient(routes());
    renderWithProviders(<SourcesScreen />, { api, route, path });
    const photos = await rowOf("Flight 14 Sep");
    expect(within(photos).getByText("Photos")).toBeInTheDocument();
    expect(within(photos).getByText("412 photos")).toBeInTheDocument();
    expect(within(photos).getByText("2026-09-14")).toBeInTheDocument();
    expect(within(photos).getByText("No run yet")).toBeInTheDocument();

    const map = await rowOf("May survey");
    expect(within(map).getByText("Map")).toBeInTheDocument();
    expect(within(map).getByText("date not set")).toBeInTheDocument();
    expect(within(map).getByText(/1,200 × 700 px/)).toBeInTheDocument();
    expect(within(map).getByText("59 objects (30 verified)")).toBeInTheDocument();
    expect(within(map).getByText("34 of 59 reviewed")).toBeInTheDocument();

    const legacy = await rowOf("Old ortho");
    expect(within(legacy).getByText("Map")).toBeInTheDocument();

    const labels = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.querySelector("th")?.textContent ?? "");
    expect(labels.map((l) => l.split("\n")[0])).toEqual([
      expect.stringContaining("Flight 14 Sep"),
      expect.stringContaining("Old ortho"),
      expect.stringContaining("May survey"),
    ]);
  });

  it("row actions: Run a model opens Runs for that source; a map also opens on its own", async () => {
    const { api } = fakeClient(routes());
    renderWithProviders(<SourcesScreen />, { api, route, path });
    const map = await rowOf("May survey");
    expect(within(map).getByRole("link", { name: "Run a model" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/runs?source=s-map`,
    );
    expect(within(map).getByRole("link", { name: "Open map" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/maps/m-linked`,
    );
    const photos = await rowOf("Flight 14 Sep");
    expect(within(photos).queryByRole("link", { name: "Open map" })).toBeNull();
    const legacy = await rowOf("Old ortho");
    expect(within(legacy).getByRole("link", { name: "Open map" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/maps/m-old`,
    );
  });

  it("editing the survey date sends PATCH and shows the saved date", async () => {
    const { api, requests } = fakeClient(
      routes([
        {
          method: "PATCH",
          path: /\/sources\/s-map$/,
          body: (req) => ({ ...mapSource, ...(req.body as object) }),
        },
      ]),
    );
    renderWithProviders(<SourcesScreen />, { api, route, path });
    const map = await rowOf("May survey");
    fireEvent.click(within(map).getByRole("button", { name: "Set the survey date of May survey" }));
    const input = within(map).getByLabelText("Survey date of May survey");
    fireEvent.change(input, { target: { value: "2026-05-20" } });
    fireEvent.click(within(map).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(map).getByText("2026-05-20")).toBeInTheDocument());
    expect(requests.find((r) => r.method === "PATCH")).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/sources/s-map`,
      body: { captured_on: "2026-05-20" },
    });
  });

  it("clearing a date sends null, and Escape cancels an edit", async () => {
    const { api, requests } = fakeClient(
      routes([
        {
          method: "PATCH",
          path: /\/sources\/s-photos$/,
          body: (req) => ({ ...photoSource, ...(req.body as object) }),
        },
      ]),
    );
    renderWithProviders(<SourcesScreen />, { api, route, path });
    const photos = await rowOf("Flight 14 Sep");
    fireEvent.click(within(photos).getByRole("button", { name: "Change the survey date of Flight 14 Sep" }));
    fireEvent.keyDown(within(photos).getByLabelText("Survey date of Flight 14 Sep"), { key: "Escape" });
    expect(within(photos).getByText("2026-09-14")).toBeInTheDocument();
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);

    fireEvent.click(within(photos).getByRole("button", { name: "Change the survey date of Flight 14 Sep" }));
    fireEvent.change(within(photos).getByLabelText("Survey date of Flight 14 Sep"), {
      target: { value: "" },
    });
    fireEvent.click(within(photos).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(photos).getByText("date not set")).toBeInTheDocument());
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ captured_on: null });
  });

  it("a map without a source is dated on the map", async () => {
    const { api, requests } = fakeClient(
      routes([
        {
          method: "PATCH",
          path: /\/maps\/m-old$/,
          body: (req) => ({ ...legacyMap, ...(req.body as object) }),
        },
      ]),
    );
    renderWithProviders(<SourcesScreen />, { api, route, path });
    const legacy = await rowOf("Old ortho");
    fireEvent.click(within(legacy).getByRole("button", { name: "Change the survey date of Old ortho" }));
    fireEvent.change(within(legacy).getByLabelText("Survey date of Old ortho"), {
      target: { value: "2025-03-02" },
    });
    fireEvent.click(within(legacy).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(legacy).getByText("2025-03-02")).toBeInTheDocument());
    expect(requests.find((r) => r.method === "PATCH")).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/maps/m-old`,
      body: { captured_on: "2025-03-02" },
    });
  });

  it("a refused date edit says why and keeps the old date", async () => {
    const { api } = fakeClient(
      routes([
        {
          method: "PATCH",
          path: /\/sources\/s-photos$/,
          status: 404,
          body: errorBody("not_found", "source gone"),
        },
      ]),
    );
    renderWithProviders(<SourcesScreen />, { api, route, path });
    const photos = await rowOf("Flight 14 Sep");
    fireEvent.click(within(photos).getByRole("button", { name: "Change the survey date of Flight 14 Sep" }));
    fireEvent.change(within(photos).getByLabelText("Survey date of Flight 14 Sep"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(within(photos).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/source gone/)).toBeInTheDocument();
  });

  it("still lists the sources when the runs list cannot be read", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/runs$/, status: 404, body: errorBody("not_found", "Not Found") },
      ...routes(),
    ]);
    renderWithProviders(<SourcesScreen />, { api, route, path });
    const map = await rowOf("May survey");
    expect(within(map).getByText("No run yet")).toBeInTheDocument();
  });

  it("an empty project offers both ways in", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/maps$/, body: { items: [] } },
      { method: "GET", path: /\/runs$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: new RegExp(`/projects/${PROJECT_ID}$`), body: exampleProject },
    ]);
    renderWithProviders(<SourcesScreen />, { api, route, path });
    expect(await screen.findByText("No photos or maps yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add photos" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Add a map" }).length).toBeGreaterThan(0);
  });

  it("Add photos and Add a map open the existing import dialogs", async () => {
    const { api } = fakeClient(routes());
    renderWithProviders(<SourcesScreen />, { api, route, path });
    await rowOf("May survey");
    fireEvent.click(screen.getByRole("button", { name: "Add a map" }));
    expect(await screen.findByRole("dialog", { name: "Import map" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add photos" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
