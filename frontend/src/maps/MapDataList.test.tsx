import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useAddData } from "@/app/addDataStore";
import { useChangesStore } from "@/store/changes";
import { exampleGeoMap, fakeClient, MAP_ID, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { detailOf } from "./dataItems";
import { MapDataList } from "./MapDataList";

const mapItem = {
  id: MAP_ID,
  type: "map" as const,
  label: "Site north ortho",
  captured_on: "2026-04-15",
  status: "ready",
  summary: { gsd_cm: 3, epsg: 32633, width: 80000, height: 60000 },
  created_at: "2026-09-22T10:00:00Z",
};
const elevationItem = {
  id: "s1",
  type: "elevation" as const,
  label: "Design surface",
  captured_on: null,
  status: "importing",
  summary: { kind: "design", cell_size_m: 0.5, z_min: 10, z_max: 30 },
  created_at: "2026-09-22T11:00:00Z",
};

function renderList(items: unknown[], next: string | null = null) {
  const fake = fakeClient([
    { method: "GET", path: /\/data$/, body: { items, next_cursor: next } },
    { method: "PATCH", path: /\/maps\/[^/]+$/, body: { ...exampleGeoMap, captured_on: "2026-04-16" } },
  ]);
  renderWithProviders(<MapDataList />, {
    api: fake.api,
    route: `/p/${PROJECT_ID}/maps`,
    path: "/p/:projectId/maps",
  });
  return fake;
}

describe("MapDataList", () => {
  beforeEach(() => {
    useChangesStore.setState({ dataRevision: 0 });
    useAddData.setState({ open: false, tile: null });
  });

  it("asks the data list for maps, elevation and drawings, one bounded page", async () => {
    const { requests } = renderList([mapItem]);
    await screen.findByText("Site north ortho");
    const url = new URL(`http://x${requests[0].url}`);
    expect(url.searchParams.getAll("type")).toEqual(["map", "elevation", "drawing"]);
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("lists each item with its type, date, state and details, and opens a map", async () => {
    renderList([mapItem, elevationItem]);
    const map = (await screen.findByRole("rowheader", { name: "Site north ortho" })).closest("tr")!;
    expect(within(map).getByRole("link", { name: "Site north ortho" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/maps/${MAP_ID}`,
    );
    expect(map).toHaveTextContent("Orthomosaic");
    expect(map).toHaveTextContent("Ready");
    expect(map).toHaveTextContent("3 cm/px · EPSG:32633");
    const surface = screen.getByRole("rowheader", { name: "Design surface" }).closest("tr")!;
    expect(surface).toHaveTextContent("Elevation");
    expect(surface).toHaveTextContent("Importing");
    expect(surface).toHaveTextContent("date not set");
  });

  it("corrects a map's survey date in place", async () => {
    const { requests } = renderList([mapItem]);
    const row = (await screen.findByRole("rowheader", { name: "Site north ortho" })).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: /Site north ortho/ }));
    fireEvent.change(within(row).getByLabelText(/Survey date of/), { target: { value: "2026-04-16" } });
    fireEvent.submit(
      within(row)
        .getByLabelText(/Survey date of/)
        .closest("form")!,
    );
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ captured_on: "2026-04-16" });
    await waitFor(() => expect(row).toHaveTextContent("2026-04-16"));
  });

  it("loads the next page on request", async () => {
    const { requests } = renderList([mapItem], "cursor-2");
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(new URL(`http://x${requests[1].url}`).searchParams.get("cursor")).toBe("cursor-2");
  });

  it("offers Add data when the project has no maps", async () => {
    renderList([]);
    fireEvent.click(await screen.findByRole("button", { name: "Add an orthomosaic" }));
    expect(useAddData.getState()).toMatchObject({ open: true, tile: "orthomosaic" });
  });

  it("formats details per type", () => {
    expect(detailOf(mapItem as never)).toBe("3 cm/px · EPSG:32633");
    expect(detailOf(elevationItem as never)).toBe("0.5 m cells");
    expect(detailOf({ ...mapItem, type: "drawing", summary: {} } as never)).toBe("");
  });
});
