import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SiteArea } from "@/api/siteAreas";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { toast } from "@/ui";
import { AUG, MAP_AUG, UTM38, renderInWorkspace, w3Stores } from "@/mapws/test/w3Fixtures";
import { useZonesStore } from "./store";
import { ZoneInspector } from "./ZoneInspector";

vi.mock("@/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui")>()),
  toast: vi.fn(),
}));

const ZONE = "5a000000-aaaa-4000-8000-000000000001";
const SQUARE = [
  [500000, 3300000],
  [501000, 3300000],
  [501000, 3301000],
  [500000, 3301000],
];
const area = {
  id: ZONE,
  name: "North laydown",
  category: "laydown",
  polygon_wgs84: [
    [45, 29.83],
    [45.01, 29.83],
    [45.01, 29.84],
    [45, 29.84],
  ],
  polygon_site: SQUARE,
  created_at: "2026-09-27T10:00:00Z",
} as unknown as SiteArea;
const analytics = {
  areas: [{ id: ZONE, name: "North laydown" }],
  surveys: [
    {
      map_id: MAP_AUG,
      map_name: "August",
      captured_on: AUG,
      state: "ok",
      per_area: {
        [ZONE]: {
          partial: true,
          counts: {
            c1: { total: 5, verified: 5 },
            c2: { total: 2, verified: 0 },
          },
        },
      },
    },
  ],
};
const ITEM = /\/site-areas\/[^/]+$/;
const LIST = /\/site-areas$/;

function renderInspector(routes: FakeRoute[] = []) {
  const { api, requests } = fakeClient([
    ...routes,
    { method: "GET", path: /\/analytics\/areas$/, body: analytics },
    {
      method: "PATCH",
      path: ITEM,
      body: (r) => ({
        ...area,
        ...(r.body as object),
        polygon_site: undefined,
      }),
    },
    { method: "DELETE", path: ITEM, status: 204 },
  ]);
  const onClose = vi.fn();
  renderInWorkspace(
    <ZoneInspector
      selection={{ kind: "zone", id: ZONE }}
      projectId={PROJECT_ID}
      frame={UTM38}
      onClose={onClose}
    />,
    { stores: w3Stores(), api },
  );
  return { api, requests, onClose };
}

describe("ZoneInspector", () => {
  beforeEach(() => {
    useZonesStore.setState({ items: [area], revision: 0 });
    vi.mocked(toast).mockClear();
  });

  it("shows name, category, the approximate area and the objects per survey", async () => {
    renderInspector();
    expect(screen.getByDisplayValue("North laydown")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue("laydown");
    expect(screen.getByText("≈ 1 000 000 m²")).toBeInTheDocument();
    expect(await screen.findByText("7 objects · partial")).toBeInTheDocument();
    expect(screen.getByText("14 Aug 2026")).toBeInTheDocument();
  });

  it("recategorises and renames through PATCH, keeping the outline", async () => {
    const { requests } = renderInspector();
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), {
      target: { value: "exclusion" },
    });
    await waitFor(() =>
      expect(requests.filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([
        { category: "exclusion" },
      ]),
    );
    await waitFor(() => expect(useZonesStore.getState().items[0].polygon_site).toEqual(SQUARE));
    const name = screen.getByDisplayValue("North laydown");
    fireEvent.change(name, { target: { value: "South laydown" } });
    fireEvent.blur(name);
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2));
  });

  it("deletes at once and closes the inspector", async () => {
    const { requests, onClose } = renderInspector();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(requests.some((r) => r.method === "DELETE")).toBe(true);
    expect(useZonesStore.getState().items).toEqual([]);
  });

  it("reads the zones itself when the selected zone is not in the store (M-W3 P12)", async () => {
    useZonesStore.setState({ items: [] });
    const { requests } = renderInspector([{ method: "GET", path: LIST, body: { items: [area] } }]);
    expect(await screen.findByDisplayValue("North laydown")).toBeInTheDocument();
    const reads = requests.filter((r) => r.method === "GET" && LIST.test(r.url.split("?")[0]));
    expect(reads).toHaveLength(1);
    expect(reads[0].url).toContain("frame=site");
    expect(useZonesStore.getState().items.map((a) => a.id)).toEqual([ZONE]);
  });

  it("says so when the zone is not loaded", async () => {
    useZonesStore.setState({ items: [] });
    renderInspector([{ method: "GET", path: LIST, body: { items: [] } }]);
    expect(await screen.findByText(/This zone is not loaded/)).toBeInTheDocument();
  });

  it("toasts a failed object-count read and says so instead of 'no survey' (W3-16)", async () => {
    renderInspector([
      {
        method: "GET",
        path: /\/analytics\/areas$/,
        status: 500,
        body: errorBody("internal", "Analytics broke"),
      },
    ]);
    expect(await screen.findByText("Object counts could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No survey covers this zone yet.")).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith("danger", expect.stringContaining("Analytics broke"));
  });
});
