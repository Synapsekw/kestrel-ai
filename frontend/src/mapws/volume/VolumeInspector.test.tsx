import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { VolumeMeasurement } from "@contract/client";
import { errorBody, exampleProject, fakeClient, runningJob } from "@/test/fixtures";
import { MEASUREMENT_ID, PROJECT_ID, exampleMeasurement, exampleSurface } from "@/test/volumeFixtures";
import { renderWithProviders } from "@/test/render";
import { useToastStore } from "@/ui";
import { useVolumeStore } from "./volumeStore";
import { VolumeInspector } from "./VolumeInspector";

const h = vi.hoisted(() => ({
  state: {
    l: null as string | null,
    select: (() => {}) as (s: unknown) => void,
  },
  activate: vi.fn(),
}));
vi.mock("@/mapws/w4host", () => ({
  useWorkspace: (sel: (s: unknown) => unknown) => sel(h.state),
  useTools: (sel: (s: unknown) => unknown) => sel({ activate: h.activate }),
}));

const UTM39 = {
  kind: "crs" as const,
  epsg: 32639,
  crs_wkt: "X",
  proj4: "+proj=utm +zone=39",
  name: "UTM 39N",
};
const UTM38 = { ...UTM39, epsg: 32638 };
const withMaterial: VolumeMeasurement = {
  ...exampleMeasurement,
  material: { name: "Gravel", density_t_m3: 1.8 },
};
function routes(m: VolumeMeasurement = withMaterial) {
  return [
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
    { method: "GET", path: /\/volumes\/[^/]+$/, body: m },
    { method: "GET", path: /\/surfaces$/, body: { items: [exampleSurface] } },
    { method: "GET", path: /\/maps$/, body: { items: [] } },
    {
      method: "PATCH",
      path: /\/volumes\/[^/]+$/,
      body: { ...m, status: "stale" },
    },
    {
      method: "POST",
      path: /\/calculate$/,
      status: 202,
      body: {
        measurement: { ...m, status: "calculating", job_id: runningJob.id },
        job: { ...runningJob, type: "volume_calc" },
      },
    },
    {
      method: "POST",
      path: /\/volume-exports$/,
      status: 202,
      body: { job: { ...runningJob, type: "volume_export" } },
    },
  ];
}
const render = (api: ReturnType<typeof fakeClient>["api"], frame = UTM39) =>
  renderWithProviders(
    <VolumeInspector
      selection={{ kind: "volume", id: MEASUREMENT_ID }}
      projectId={PROJECT_ID}
      frame={frame}
      onClose={() => {}}
    />,
    { api },
  );

describe("VolumeInspector", () => {
  beforeEach(() => {
    localStorage.clear();
    useVolumeStore.setState({ autoRecalc: true, heatmap: true, drawing: null });
  });

  it("shows net, cut and fill, tonnage and the uncertainty", async () => {
    render(fakeClient(routes()).api);
    expect(await screen.findByTestId("volume-inspector")).toBeInTheDocument();
    expect(screen.getByTestId("volume-net")).toHaveTextContent("1 232.4 m³");
    expect(screen.getByText("2 218.3 t")).toBeInTheDocument();
    expect(screen.getByText(/± 14\.2 m³/)).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Base surface" })).toBeInTheDocument();
  });

  it("a base card click patches and recalculates, and the numbers dim while calculating", async () => {
    const { api, requests } = fakeClient(routes());
    render(api);
    fireEvent.click(await screen.findByRole("radio", { name: "Lowest point" }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/calculate"))).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
      base: { kind: "toe_lowest" },
    });
    expect(await screen.findByTestId("volume-calculating")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Calculating the volume" })).toBeInTheDocument();
  });

  it("with auto-recalculate off a stale measurement offers Recalculate", async () => {
    useVolumeStore.setState({ autoRecalc: false });
    const { api, requests } = fakeClient(
      routes({
        ...withMaterial,
        status: "stale",
        stale_reasons: ["base changed"],
      }),
    );
    render(api);
    fireEvent.click(await screen.findByRole("button", { name: "Recalculate" }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/calculate"))).toBe(true));
  });

  it("exports a CSV through the volume_export job", async () => {
    const { api, requests } = fakeClient(routes());
    render(api);
    fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/volume-exports"))?.body).toEqual({
        measurement_ids: [MEASUREMENT_ID],
        formats: ["csv"],
      }),
    );
  });

  it("saves a material without recalculating", async () => {
    const { api, requests } = fakeClient(routes({ ...exampleMeasurement, material: null }));
    render(api);
    fireEvent.change(await screen.findByLabelText("Material"), {
      target: { value: "Sand" },
    });
    fireEvent.change(screen.getByLabelText("Density (t/m³)"), {
      target: { value: "1.6" },
    });
    fireEvent.blur(screen.getByLabelText("Density (t/m³)"));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
        material: { name: "Sand", density_t_m3: 1.6 },
      }),
    );
    expect(requests.some((r) => r.url.endsWith("/calculate"))).toBe(false);
  });

  it("starts and stops a mask drawing through the volume tool", async () => {
    h.activate.mockClear();
    render(fakeClient(routes()).api);
    fireEvent.click(await screen.findByRole("button", { name: /Masks & alignment/ }));
    const exclusion = screen.getByRole("button", { name: "Draw exclusion" });
    fireEvent.click(exclusion);
    expect(useVolumeStore.getState().drawing).toBe("exclusion");
    expect(h.activate).toHaveBeenLastCalledWith("volume");
    fireEvent.click(exclusion);
    expect(useVolumeStore.getState().drawing).toBeNull();
    expect(h.activate).toHaveBeenLastCalledWith("select");
  });

  it("disables mask drawing with the reason and links the volume view when the surface is in another CRS", async () => {
    render(fakeClient(routes()).api, UTM38);
    fireEvent.click(await screen.findByRole("button", { name: /Masks & alignment/ }));
    expect(screen.getByRole("button", { name: "Draw exclusion" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Open it there" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/measurements/${MEASUREMENT_ID}`,
    );
  });

  it("toggles the heatmap for this viewer", async () => {
    render(fakeClient(routes()).api);
    fireEvent.click(await screen.findByRole("switch", { name: "Cut / fill heatmap" }));
    expect(useVolumeStore.getState().heatmap).toBe(false);
  });

  it("a failed load shows inline with Retry, not as a toast", async () => {
    useToastStore.getState().clear();
    let fail = true;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/volumes\/[^/]+$/,
        status: () => (fail ? 500 : 200),
        body: () => (fail ? errorBody("internal", "boom") : withMaterial),
      },
      ...routes(),
    ]);
    render(api);
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(useToastStore.getState().toasts).toHaveLength(0);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("volume-inspector")).toBeInTheDocument();
  });

  it("says so when the top surface is gone instead of loading forever", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/surfaces$/, body: { items: [] } }, ...routes()]);
    render(api);
    expect(await screen.findByText(/top surface of this measurement is gone/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open it there" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/measurements/${MEASUREMENT_ID}`,
    );
  });
});
