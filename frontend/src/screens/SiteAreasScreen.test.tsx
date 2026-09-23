import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SiteAreasScreen } from "./SiteAreasScreen";
import { exampleGeoMap, fakeClient, type FakeRoute } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { AREA_1, MAP_ID, PROJECT_ID, siteAreas } from "@/analytics/fixtures";

function MapProbe() {
  const loc = useLocation();
  return <p data-testid="map-probe">{loc.pathname + loc.search}</p>;
}

function renderScreen(routes: FakeRoute[]) {
  const { api, requests } = fakeClient([
    ...routes,
    { method: "GET", path: /site-areas$/, body: { items: siteAreas } },
    {
      method: "GET",
      path: /\/maps$/,
      body: { items: [exampleGeoMap, { ...exampleGeoMap, id: "flat", name: "Flat scan", proj4: null }] },
    },
  ]);
  render(
    <TestApiProvider api={api}>
      <MemoryRouter initialEntries={[`/p/${PROJECT_ID}/site-areas`]}>
        <Routes>
          <Route path="/p/:projectId/site-areas" element={<SiteAreasScreen />} />
          <Route path="/p/:projectId/maps/:mapId" element={<MapProbe />} />
        </Routes>
      </MemoryRouter>
    </TestApiProvider>,
  );
  return requests;
}

describe("SiteAreasScreen", () => {
  it("lists the site areas", async () => {
    renderScreen([]);
    expect(await screen.findByText("North laydown yard")).toBeInTheDocument();
  });

  it("renames an area", async () => {
    const requests = renderScreen([
      { method: "PATCH", path: /site-areas\//, body: { ...siteAreas[0], name: "North yard" } },
    ]);
    const row = (await screen.findByText("North laydown yard")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Rename" }));
    const input = within(row).getByLabelText("New name");
    fireEvent.change(input, { target: { value: "North yard" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.url).toContain(`/site-areas/${AREA_1}`);
    expect(patch.body).toEqual({ name: "North yard" });
    expect(await screen.findByText("North yard")).toBeInTheDocument();
  });

  it("deletes an area after asking", async () => {
    const requests = renderScreen([{ method: "DELETE", path: /site-areas\//, status: 204 }]);
    const row = (await screen.findByText("North laydown yard")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    fireEvent.click(within(row).getByRole("button", { name: "Delete site area" }));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByText("North laydown yard")).not.toBeInTheDocument());
  });

  it("opens the chosen map with the outline tool", async () => {
    renderScreen([]);
    const select = await screen.findByLabelText("Map");
    // Only a georeferenced map can place an area on the ground.
    expect(within(select).queryByText(/Flat scan/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Draw an area" }));
    expect(await screen.findByTestId("map-probe")).toHaveTextContent(
      `/p/${PROJECT_ID}/maps/${MAP_ID}?draw=site-area`,
    );
  });

  it("explains site areas when there are none", async () => {
    renderScreen([{ method: "GET", path: /site-areas$/, body: { items: [] } }]);
    expect(await screen.findByText("No site areas yet")).toBeInTheDocument();
  });
});
