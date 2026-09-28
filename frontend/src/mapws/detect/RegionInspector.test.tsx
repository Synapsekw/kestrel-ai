import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { PROJECT_ID, exampleGeoMap, exampleTrainedModel, fakeClient, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useDetectStore } from "./detectStore";
import { RegionInspector } from "./RegionInspector";

const h = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/mapws/w4host", async () => {
  const { formatSurveyDate } = await import("@/mapws/timeline/timelineModel");
  const { mapSurveyDate } = await import("@/mapws/arrival/arrival");
  return {
    formatSurveyDate,
    mapSurveyDate,
    useWorkspace: (sel: (s: unknown) => unknown) => sel({ r: "2026-04-15", select: h.select }),
  };
});
const ring = [
  [0, 0],
  [5, 0],
  [5, 5],
  [0, 5],
];
const FRAME = {
  kind: "crs" as const,
  epsg: 32639,
  crs_wkt: "X",
  proj4: "+proj=utm",
  name: "UTM",
};
const mapSource = {
  id: "src-1",
  kind: "map",
  map_id: exampleGeoMap.id,
  label: "",
  folder: "",
  captured_on: null,
  image_count: 0,
};

function routes(
  post: { status?: number; body: object },
  sources: object[] = [mapSource],
  library?: { status: number; body: object },
) {
  return [
    { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
    { method: "GET", path: /\/sources$/, body: { items: sources, next_cursor: null } },
    {
      method: "GET",
      path: /\/library\/models/,
      status: library?.status ?? 200,
      body: library?.body ?? {
        items: [{ ...exampleTrainedModel, state: "ready", train_gsd_cm: 2 }],
        next_cursor: null,
      },
    },
    { method: "POST", path: /\/runs$/, status: post.status ?? 202, body: post.body },
  ];
}
const render = (api: ReturnType<typeof fakeClient>["api"]) =>
  renderWithProviders(
    <RegionInspector
      selection={{ kind: "region", id: "draft" }}
      projectId={PROJECT_ID}
      frame={FRAME}
      onClose={() => {}}
    />,
    { api },
  );

describe("RegionInspector", () => {
  beforeEach(() => {
    h.select.mockReset();
    useDetectStore.setState({ regionDraft: ring, outlines: [] });
  });

  it("starts a region run and shows its outline", async () => {
    const { api, requests } = fakeClient(
      routes({
        body: {
          runs: [{ run_id: "rr1", source_id: "src-1", kind: "map", job: runningJob }],
          added_type_ids: [],
        },
      }),
    );
    render(api);
    expect(await screen.findByTestId("region-inspector")).toBeInTheDocument();
    const run = await screen.findByRole("button", { name: "Run" });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    await waitFor(() => expect(h.select).toHaveBeenCalledWith({ kind: "run", id: "rr1" }));
    expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({
      source_ids: ["src-1"],
      conf: 0.25,
      target_gsd_cm: 2,
      model_id: exampleTrainedModel.id,
      region: { map_id: exampleGeoMap.id, polygon_site: ring },
    });
    expect(useDetectStore.getState().outlines).toEqual([{ runId: "rr1", jobId: runningJob.id, ring }]);
    expect(useDetectStore.getState().regionDraft).toBeNull();
    expect(localStorage.getItem("kestrel.mapws.lastDetectModel")).toBe(exampleTrainedModel.id);
  });

  it("shows the empty_region message and queues nothing", async () => {
    render(
      fakeClient(
        routes({
          status: 422,
          body: { error: { code: "empty_region", message: "empty", details: {} } },
        }),
      ).api,
    );
    const run = await screen.findByRole("button", { name: "Run" });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    expect(await screen.findByText(/Nothing to scan in this box/)).toBeInTheDocument();
    expect(useDetectStore.getState().outlines).toEqual([]);
    expect(h.select).not.toHaveBeenCalled();
  });

  it("refuses a map without a detection source before any request", async () => {
    const { api, requests } = fakeClient(routes({ body: {} }, [{ ...mapSource, map_id: "another-map" }]));
    render(api);
    expect(await screen.findByText(/no detection source/)).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Run" });
    expect(run).toBeDisabled();
    fireEvent.click(run);
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("says the model library failed to load instead of advising to add a model", async () => {
    const { api, requests } = fakeClient(
      routes({ body: {} }, [mapSource], {
        status: 500,
        body: { error: { code: "internal", message: "db locked", details: {} } },
      }),
    );
    render(api);
    expect(await screen.findByText(/Could not load the model library \(db locked\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Add one in Models/)).toBeNull();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("says the model library is unavailable when the app started without it", async () => {
    render(
      fakeClient(
        routes({ body: {} }, [mapSource], {
          status: 503,
          body: { error: { code: "library_unavailable", message: "no library", details: {} } },
        }),
      ).api,
    );
    expect(await screen.findByText(/The model library is not available/)).toBeInTheDocument();
    expect(screen.queryByText(/Add one in Models/)).toBeNull();
  });
});
