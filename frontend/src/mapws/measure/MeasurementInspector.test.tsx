import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { useToastStore } from "@/ui";
import {
  DESIGN,
  DSM_AUG,
  DSM_SEP,
  MEASURE_ID,
  MEASURE_ID_2,
  UTM38,
  measurement,
  renderInWorkspace,
  w3Stores,
} from "@/mapws/test/w3Fixtures";
import measurementInspector from "@/mapws/inspect/measurement.inspector";
import { MeasurementInspector } from "./MeasurementInspector";
import { profileView } from "./results";
import { useMeasurementsStore } from "./store";

const ITEM = /\/map-measurements\/[^/]+$/;
const sel = (id = MEASURE_ID) => ({ kind: "measurement", id });

function renderInspector(routes: FakeRoute[]) {
  const { api, requests } = fakeClient(routes);
  const onClose = vi.fn();
  renderInWorkspace(
    <MeasurementInspector selection={sel()} projectId={PROJECT_ID} frame={UTM38} onClose={onClose} />,
    { stores: w3Stores(), api },
  );
  return { requests, onClose };
}

const patchRoute = (base: ReturnType<typeof measurement>): FakeRoute => ({
  method: "PATCH",
  path: ITEM,
  body: (r) => ({ ...base, ...(r.body as object) }),
});
const patches = (requests: { method: string; body: unknown }[]) =>
  requests.filter((r) => r.method === "PATCH").map((r) => r.body);
const geometry = () => within(screen.getByRole("region", { name: "Geometry" }));
const stored = (id = MEASURE_ID) => useMeasurementsStore.getState().items.find((m) => m.id === id);

describe("MeasurementInspector", () => {
  beforeEach(() => {
    useToastStore.getState().clear();
    useMeasurementsStore.getState().set([], false);
  });

  it("a distance leads with the ellipsoidal length and lists grid, scale factor, 3D, vertices and CRS", async () => {
    renderInspector([{ method: "GET", path: ITEM, body: measurement("distance") }]);
    expect(await screen.findByDisplayValue("Distance 1")).toBeInTheDocument();
    expect(screen.getByText("50.02 m")).toBeInTheDocument();
    expect(screen.getByText("On the ellipsoid (WGS 84)")).toBeInTheDocument();
    expect(screen.getByText("50.00 m")).toBeInTheDocument();
    expect(screen.getByText("0.99962")).toBeInTheDocument();
    expect(screen.getByText("50.31 m")).toBeInTheDocument();
    expect(geometry().getByText("EPSG:32638")).toBeInTheDocument();
    expect(geometry().getByText("2")).toBeInTheDocument();
  });

  it("a local measurement shows grid values only", async () => {
    const local = measurement("distance", {
      epsg: null,
      crs_wkt: null,
      results: {
        length_m: null,
        grid_length_m: 50,
        scale_factor: null,
        length_3d_m: null,
        nodata_fraction: null,
        dsm_surface_id: null,
      },
    });
    renderInspector([{ method: "GET", path: ITEM, body: local }]);
    expect(await screen.findByText("Local metres, on the grid")).toBeInTheDocument();
    expect(screen.getByText("Local metres")).toBeInTheDocument();
    expect(screen.queryByText("Scale factor")).toBeNull();
    expect(screen.queryByText(/ellipsoid/)).toBeNull();
  });

  it("an area shows area, grid area and the areal scale factor", async () => {
    renderInspector([{ method: "GET", path: ITEM, body: measurement("area") }]);
    expect(await screen.findByText("1 000 752 m²")).toBeInTheDocument();
    expect(screen.getByText("1 000 000 m²")).toBeInTheDocument();
    expect(screen.getByText("0.99925")).toBeInTheDocument();
  });

  it("a profile draws its chart, heights and cut/fill, and changes surfaces through PATCH", async () => {
    const base = measurement("profile");
    const { requests } = renderInspector([{ method: "GET", path: ITEM, body: base }, patchRoute(base)]);
    expect(await screen.findByTestId("profile-chart")).toBeInTheDocument();
    expect(screen.getByText("600.00 m")).toBeInTheDocument();
    expect(screen.getByText("606.00 m")).toBeInTheDocument();
    expect(screen.getByText("6.00 m")).toBeInTheDocument();
    expect(screen.getByText("10.0 m²")).toBeInTheDocument();
    expect(screen.getByText("40.0 m²")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /DSM 14 Aug/ })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Site plan rev C" }));
    await waitFor(() => expect(patches(requests)).toEqual([{ surface_ids: [DSM_AUG, DSM_SEP, DESIGN] }]));
  });

  it("writes the full profile row (stations, series, updated_at) into the layer's store after the GET (A14)", async () => {
    renderInspector([{ method: "GET", path: ITEM, body: measurement("profile") }]);
    await screen.findByTestId("profile-chart");
    const row = stored();
    expect(row?.updated_at).toBe("2026-09-27T10:00:00Z");
    expect(profileView(row!).stations).toEqual([0, 10, 20, 30, 40, 50]);
    expect(profileView(row!).series.map((s) => s.surfaceId)).toEqual([DSM_AUG, DSM_SEP]);
  });

  it("a PATCH answer without site vertices keeps the geometry in the inspector and the store", async () => {
    const base = measurement("distance");
    // PATCH takes no frame: its answer carries no site geometry (absent or null).
    const noSite = { ...base, vertices_site: null };
    const { requests } = renderInspector([
      { method: "GET", path: ITEM, body: base },
      {
        method: "PATCH",
        path: ITEM,
        body: (r) => ({ ...noSite, ...(r.body as object), updated_at: "2026-09-28T08:00:00Z" }),
      },
    ]);
    const input = await screen.findByDisplayValue("Distance 1");
    fireEvent.change(input, { target: { value: "Gate to crane" } });
    fireEvent.blur(input);
    await waitFor(() => expect(stored()?.name).toBe("Gate to crane"));
    expect(patches(requests)).toEqual([{ name: "Gate to crane" }]);
    expect(stored()?.updated_at).toBe("2026-09-28T08:00:00Z");
    expect(stored()?.vertices_site).toEqual(base.vertices_site);
    expect(geometry().getByText("2")).toBeInTheDocument();
  });

  it("refuses to drop the last surface", async () => {
    const one = measurement("profile", { surface_ids: [DSM_SEP] });
    const { requests } = renderInspector([{ method: "GET", path: ITEM, body: one }, patchRoute(one)]);
    fireEvent.click(await screen.findByRole("checkbox", { name: /DSM 14 Sep/ }));
    expect(useToastStore.getState().toasts.map((t) => t.text)).toContain(
      "A profile needs at least one surface",
    );
    expect(patches(requests)).toEqual([]);
  });

  it("renames on blur, and a blank name is not saved", async () => {
    const base = measurement("distance");
    const { requests } = renderInspector([{ method: "GET", path: ITEM, body: base }, patchRoute(base)]);
    const input = await screen.findByDisplayValue("Distance 1");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue("Distance 1")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Gate to crane" } });
    fireEvent.blur(input);
    await waitFor(() => expect(patches(requests)).toEqual([{ name: "Gate to crane" }]));
  });

  it("deletes and closes the inspector", async () => {
    const { requests, onClose } = renderInspector([
      { method: "GET", path: ITEM, body: measurement("distance") },
      { method: "DELETE", path: ITEM, status: 204 },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(requests.some((r) => r.method === "DELETE")).toBe(true);
  });

  it("says so when the measurement is gone", async () => {
    renderInspector([
      {
        method: "GET",
        path: ITEM,
        status: 404,
        body: { error: { code: "not_found", message: "x", details: {} } },
      },
    ]);
    expect(await screen.findByText("This measurement was deleted.")).toBeInTheDocument();
  });

  it("a stale response is ignored after the selection changes", async () => {
    const pending = new Map<string, (v: unknown) => void>();
    const api = {
      GET: vi.fn(
        (_path: string, opts: { params: { path: { mapMeasurementId: string } } }) =>
          new Promise((resolve) => pending.set(opts.params.path.mapMeasurementId, resolve)),
      ),
    } as unknown as ApiClient;
    const ok = (data: unknown) => ({
      data,
      response: new Response(null, { status: 200 }),
    });
    function Switcher() {
      const [id, setId] = useState(MEASURE_ID);
      return (
        <>
          <button type="button" onClick={() => setId(MEASURE_ID_2)}>
            next
          </button>
          <MeasurementInspector
            selection={sel(id)}
            projectId={PROJECT_ID}
            frame={UTM38}
            onClose={() => undefined}
          />
        </>
      );
    }
    renderInWorkspace(<Switcher />, { stores: w3Stores(), api });
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await act(async () =>
      pending.get(MEASURE_ID_2)?.(ok(measurement("area", { id: MEASURE_ID_2, name: "Area 7" }))),
    );
    await act(async () => pending.get(MEASURE_ID)?.(ok(measurement("distance"))));
    expect(screen.getByDisplayValue("Area 7")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Distance 1")).toBeNull();
    expect(stored(MEASURE_ID)).toBeUndefined();
  });
});

describe("the measurement inspector plugin", () => {
  it("is framed, and its Del confirm line does not repeat W1's dialog title (A17)", () => {
    expect(measurementInspector).toMatchObject({ id: "measurement", label: "Measurement", framed: true });
    expect(measurementInspector.remove?.confirm(sel())).toBe("This cannot be undone.");
  });
});
