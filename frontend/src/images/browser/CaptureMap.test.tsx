import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { exampleGeoMap, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import type { CaptureMapOptions } from "./olCaptureMap";
import { CaptureMap } from "./CaptureMap";
import { MiniMap } from "./MiniMap";
import { idAt, imageRow, makeIndexState } from "./testing";
import { resetDetailsForTests } from "./useImageDetails";

// OpenLayers needs a canvas and WebGL; the builder is replaced by a recorder.
const ol = vi.hoisted(() => ({
  created: [] as CaptureMapOptions[],
  calls: [] as [string, unknown[]][],
  webgl: "Test GL" as string | null,
}));
vi.mock("@/app/effects", () => ({ rendererName: () => ol.webgl }));
vi.mock("./olCaptureMap", () => ({
  createCaptureMap: (o: CaptureMapOptions) => {
    ol.created.push(o);
    const rec =
      (name: string) =>
      (...args: unknown[]) =>
        ol.calls.push([name, args]);
    return {
      setPoints: rec("setPoints"),
      setPointStyle: rec("setPointStyle"),
      setCurrent: rec("setCurrent"),
      setFootprint: rec("setFootprint"),
      setFlightPath: rec("setFlightPath"),
      fit: rec("fit"),
      destroy: rec("destroy"),
    };
  },
}));

const last = (name: string) => [...ol.calls].reverse().find(([n]) => n === name)?.[1];

function renderMap(n: number, over: Partial<Parameters<typeof CaptureMap>[0]> = {}, maps = [] as unknown[]) {
  const { api } = fakeClient([
    { method: "GET", path: /\/maps$/, body: { items: maps, next_cursor: null } },
    {
      method: "GET",
      path: /\/images$/,
      body: (r) => ({
        items: (new URL(r.url, "http://fake").searchParams.get("ids") ?? "")
          .split(",")
          .map((id) => imageRow(id, Number(id.slice(4)))),
        next_cursor: null,
      }),
    },
  ]);
  const onOpen = vi.fn();
  const onLasso = vi.fn();
  const index = makeIndexState(n);
  renderWithProviders(
    <CaptureMap
      projectId={PROJECT_ID}
      index={index}
      currentId={null}
      sort="capture_time"
      footprint={null}
      onOpen={onOpen}
      onLasso={onLasso}
      {...over}
    />,
    { api },
  );
  return { onOpen, onLasso, index };
}

describe("CaptureMap", () => {
  beforeEach(() => {
    ol.created.length = 0;
    ol.calls.length = 0;
    ol.webgl = "Test GL";
    resetDetailsForTests();
  });

  it("draws one point per image with GPS, from the index only", async () => {
    renderMap(30);
    await waitFor(() => expect(last("setPoints")).toBeDefined());
    const [ordinals] = last("setPoints") as [number[]];
    expect(ordinals).toHaveLength(10); // every 3rd of 30
    expect(screen.getByText("Capture points · 10")).toBeInTheDocument();
    expect(ol.created[0].projection.kind).toBe("mercator");
  });

  it("says how many images have no location", async () => {
    renderMap(30);
    expect(await screen.findByText("20 of 30 without location")).toBeInTheDocument();
  });

  it("uses a covering ortho as the background", async () => {
    const geo = {
      ...exampleGeoMap,
      status: "ready",
      proj4: "+proj=longlat +datum=WGS84 +no_defs",
      geotransform: [55.0, 0.001, 0, 25.5, 0, -0.001],
      bounds_wgs84: [55.0, 25.0, 56.0, 25.5],
    };
    renderMap(30, {}, [geo]);
    await waitFor(() => expect(ol.created.some((o) => o.projection.kind === "ortho")).toBe(true));
    expect(ol.created.at(-1)!.tileUrl).toContain(`/maps/${geo.id}/tiles/{z}/{x}/{y}`);
  });

  it("a click on a point opens that image; a lasso hands its ids over", async () => {
    const { onOpen, onLasso } = renderMap(30);
    await waitFor(() => expect(ol.created).toHaveLength(1));
    act(() => ol.created[0].onClick(9));
    expect(onOpen).toHaveBeenCalledWith(idAt(9));
    act(() => ol.created[0].onLasso!([-1e12, -1e12, 1e12, 1e12]));
    expect(onLasso.mock.lastCall![0]).toHaveLength(10);
  });

  it("marks the current frame and draws its footprint, which the chip hides", async () => {
    const ring = [
      [55.29, 25.27],
      [55.3, 25.27],
      [55.3, 25.26],
      [55.29, 25.26],
      [55.29, 25.27],
    ];
    renderMap(30, {
      currentId: idAt(3),
      footprint: { kind: "trapezoid", geometry: { type: "Polygon", coordinates: [ring] }, yawDeg: 0 },
    });
    await waitFor(() => expect(last("setCurrent")?.[0]).not.toBeNull());
    expect((last("setFootprint")?.[0] as { kind: string }).kind).toBe("polygon");
    fireEvent.click(screen.getByRole("button", { name: "Footprint on" }));
    expect(last("setFootprint")?.[0]).toBeNull();
    expect(last("setFlightPath")?.[0]).not.toBeNull();
  });

  it("shows the hovered image's stem, count and severity", async () => {
    renderMap(30);
    await waitFor(() => expect(ol.created).toHaveLength(1));
    act(() => ol.created[0].onHover(15, [40, 40]));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("DJI_0015");
    expect(screen.getByRole("tooltip")).toHaveTextContent("2 findings · Major");
    act(() => ol.created[0].onHover(null, null));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("without WebGL says so and builds nothing", () => {
    ol.webgl = null;
    renderMap(30);
    expect(screen.getByText(/needs WebGL/)).toBeInTheDocument();
    expect(ol.created).toHaveLength(0);
  });
});

describe("MiniMap", () => {
  beforeEach(() => {
    ol.created.length = 0;
    ol.calls.length = 0;
    ol.webgl = "Test GL";
  });

  it("is a 168 px non-interactive map with its chips and an expand button", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/maps$/, body: { items: [], next_cursor: null } }]);
    const onExpand = vi.fn();
    renderWithProviders(
      <MiniMap
        projectId={PROJECT_ID}
        index={makeIndexState(30)}
        currentId={null}
        onOpen={() => {}}
        onExpand={onExpand}
      />,
      { api },
    );
    await waitFor(() => expect(ol.created).toHaveLength(1));
    expect(ol.created[0].interactive).toBe(false);
    expect(ol.created[0].onLasso).toBeUndefined();
    expect(screen.getByText("GPS · EXIF · 10 pts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open the capture map" }));
    expect(onExpand).toHaveBeenCalled();
  });

  it("reads 0 pts for a flight without GPS", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/maps$/, body: { items: [], next_cursor: null } }]);
    const noGps = makeIndexState(2, { lon: [null, null], lat: [null, null] });
    renderWithProviders(
      <MiniMap projectId={PROJECT_ID} index={noGps} currentId={null} onOpen={() => {}} onExpand={() => {}} />,
      {
        api,
      },
    );
    expect(await screen.findByText("GPS · EXIF · 0 pts")).toBeInTheDocument();
  });
});
