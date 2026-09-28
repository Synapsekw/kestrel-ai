import { useEffect, useState } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@contract/client";
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import type { FrameCamera } from "@/clouds/viewer/types";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { errorBody, exampleJob, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { useToastStore } from "@/ui";
import { HintBar } from "../HintBar";
import { WorkspaceSeamsContext, type WorkspaceSeams } from "../seams";
import { ENTRY, type CloudToolId } from "../tools";
import type { FeatureContext, WorkspaceFeature, WorkspaceViewState } from "../types";
import type { ProfilePanelProps } from "@/clouds/measuring/ProfilePanel";
import { useMeasureFeature } from "./measure";

// The real panel, with its props recorded: jsdom has no 2D canvas, so what the panel was handed
// (its data, its "Save as distance" callback) is read here rather than off pixels.
const panelProps = vi.hoisted(() => ({ last: null as ProfilePanelProps | null }));
vi.mock("@/clouds/measuring/ProfilePanel", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/clouds/measuring/ProfilePanel")>();
  return {
    ...real,
    ProfilePanel: (props: ProfilePanelProps) => {
      panelProps.last = props;
      return <real.ProfilePanel {...props} />;
    },
  };
});

// The promises the feature awaits, recorded so a test can wait for an answer to have been handled
// (its handler was attached first, so it has run by the time an await on the same promise resumes)
// instead of sleeping a fixed time.
const seen = vi.hoisted(() => ({
  previews: [] as Promise<unknown>[],
  profiles: new Map<string, Promise<unknown>>(),
}));
vi.mock("@/clouds/measuring/slab", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/clouds/measuring/slab")>();
  return {
    ...real,
    previewSlab: (...args: Parameters<typeof real.previewSlab>) => {
      const p = real.previewSlab(...args);
      seen.previews.push(p);
      return p;
    },
  };
});
vi.mock("@/api/cloudMeasurements", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/api/cloudMeasurements")>();
  return {
    ...real,
    getCloudProfile: (...args: Parameters<typeof real.getCloudProfile>) => {
      const p = real.getCloudProfile(...args);
      seen.profiles.set(args[3], p);
      return p;
    },
  };
});
/** Resolves once the feature has handled `p`'s answer (or rejection) and React has re-rendered. */
const handled = (p: Promise<unknown> | undefined) =>
  act(async () => {
    await p?.then(
      () => undefined,
      () => undefined,
    );
  });

const base = {
  point_cloud_id: CLOUD_ID,
  note: null,
  error: null,
  job_id: null,
  finding_id: null,
  view: null,
  created_at: "2026-09-27T10:00:00Z",
  updated_at: "2026-09-27T10:00:00Z",
};
const E = 243500;
const N = 3178000;
const pick = (x: number, y: number, z = 0) => ({ x, y, z, level: 5, uncertainty_m: 0.02 });

function fakeViewer() {
  const frames: ((c: FrameCamera) => void)[] = [];
  const h = {
    setOverlay: vi.fn(),
    lookAt: vi.fn(),
    goToPose: vi.fn(),
    project: vi.fn((p: { x: number; y: number }) => ({ x: p.x * 100, y: p.y * 100 })),
    canvasRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }),
    onFrame: vi.fn((cb: (c: FrameCamera) => void) => {
      frames.push(cb);
      return () => undefined;
    }),
    sampleSlab: vi.fn(async (a: number[], b: number[], thicknessM: number) => ({
      s: new Float64Array([0, 1, 2]),
      z: new Float64Array([5, 6, 5]),
      rgb: null,
      count: 3,
      total: 3,
      a,
      b,
      thicknessM,
    })),
    setClipBox: vi.fn(),
  };
  return { h, ref: { current: h as unknown as CloudViewerHandle }, frames };
}

function mount(active: CloudToolId, routes: FakeRoute[], wrap: (api: ApiClient) => ApiClient = (a) => a) {
  const { api, requests } = fakeClient(routes);
  const viewer = fakeViewer();
  const seams: WorkspaceSeams = { requestViewCapture: vi.fn(), ReportViewCard: null, LikelyViews: null };
  const showTab = vi.fn();
  const restoreClipBox = vi.fn();
  let feature: WorkspaceFeature | null = null;
  let setViewState: (v: WorkspaceViewState) => void = () => undefined;
  function Harness() {
    const [viewState, setVs] = useState<WorkspaceViewState>("running");
    setViewState = setVs;
    const ctx: FeatureContext = {
      projectId: PROJECT_ID,
      cloud: exampleCloud,
      maps: [],
      viewer: viewer.ref,
      viewState,
      activeTool: active,
      search: "",
      seams,
      render: { colour: "rgb", elevationRange: [0, 1], pointSize: 1, budget: 3_000_000, edl: true },
      clipBox: null,
      arm: vi.fn(),
      showTab,
      restoreClipBox,
    };
    const f = useMeasureFeature(ctx);
    useEffect(() => {
      feature = f;
    });
    const t = f.tools?.find((x) => x.id === active) ?? null;
    return (
      <WorkspaceSeamsContext.Provider value={seams}>
        <HintBar entry={ENTRY[active]} tool={t} progress={null} onCancel={() => t?.onCancel?.()} />
        {f.layer}
        {f.floating}
        {f.measurementsTab?.body}
      </WorkspaceSeamsContext.Provider>
    );
  }
  renderWithProviders(<Harness />, { api: wrap(api) });
  const tool = () => feature!.tools!.find((x) => x.id === active)!;
  const tap = (pts: ReturnType<typeof pick>[]) => pts.forEach((p) => act(() => tool().onPick!(p)));
  return {
    requests,
    viewer,
    seams,
    showTab,
    restoreClipBox,
    tool,
    tap,
    feature: () => feature!,
    setViewState: (v: WorkspaceViewState) => setViewState(v),
  };
}

const listRoute = (rows: () => unknown[]): FakeRoute => ({
  method: "GET",
  path: /\/pointclouds\/[^/]+\/measurements$/,
  body: () => ({ items: rows() }),
});
const posts = (requests: { method: string }[]) => requests.filter((r) => r.method === "POST");
const lastOverlay = (h: { setOverlay: { mock: { calls: unknown[][] } } }) =>
  h.setOverlay.mock.calls.at(-1)![1] as { kind: string; points: { x: number; y: number }[] }[];
const sectionAt = (y: number) => [
  { x: E, y, z: 5, uncertainty_m: 0.02 },
  { x: E + 12, y, z: 5, uncertainty_m: 0.02 },
];
const savedProfile = (id: string, status: string, y = N) => ({
  ...base,
  id,
  kind: "profile",
  name: `Section ${id}`,
  status,
  points: sectionAt(y),
  params: { thickness_m: 0.2 },
  results: {},
});
const profileBody = { s: [0, 1, 2], z: [5, 6, 5], rgb: null, count: 3, thickness_m: 0.2, length_m: 12 };

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useChangesStore.setState({ pointcloudsRevision: 0 });
  useToastStore.getState().clear();
  panelProps.last = null;
  seen.previews.length = 0;
  seen.profiles.clear();
});

describe("the measure feature (C-M1 in C-W1's slot)", () => {
  it("offers the six measure tools, and arming one opens the Measurements tab", async () => {
    const m = mount("distance", [listRoute(() => [])]);
    await screen.findByTestId("measure-hint");
    expect(m.feature().tools!.map((t) => t.id)).toEqual([
      "point",
      "distance",
      "height",
      "vertical",
      "area",
      "section",
    ]);
    act(() => m.tool().onArm!());
    expect(m.showTab).toHaveBeenCalledWith("measurements");
  });

  it("area: four picks and Enter save the outline with its mode and view direction, then ask for a capture", async () => {
    const rows: unknown[] = [];
    const m = mount("area", [
      listRoute(() => rows),
      {
        method: "POST",
        path: /\/measurements$/,
        status: 201,
        body: (r) => {
          const row = {
            ...base,
            id: "a1",
            kind: "area",
            name: "Area 1",
            status: "ready",
            ...(r.body as object),
            results: { area_m2: 4 },
          };
          rows.push(row);
          return row;
        },
      },
    ]);
    await screen.findByTestId("measure-hint");
    act(() => m.viewer.frames.forEach((f) => f({ direction: [0, 0.6, -0.8] } as unknown as FrameCamera)));
    m.tap([pick(E, N), pick(E + 2, N), pick(E + 2, N + 2), pick(E, N + 2)]);
    expect(screen.getByTestId("measure-hint")).toHaveTextContent("4 vertices");
    expect(m.tool().canCommit).toBe(true);
    act(() => m.tool().onCommit!());
    await waitFor(() => expect(posts(m.requests)).toHaveLength(1));
    const body = posts(m.requests)[0] as unknown as {
      body: { kind: string; points: unknown[]; params: unknown };
    };
    expect(body.body.kind).toBe("area");
    expect(body.body.points).toHaveLength(4);
    expect(body.body.params).toEqual({ mode: "surface", view_dir: [0, 0.6, -0.8] });
    await waitFor(() =>
      expect(m.seams.requestViewCapture).toHaveBeenCalledWith(
        { kind: "cloud_measurement", id: "a1" },
        "save",
      ),
    );
    await waitFor(() => expect(screen.getByTestId("measure-hint")).toHaveTextContent("0 vertices"));
    expect(screen.getByRole("button", { name: /Area 1/ })).toBeInTheDocument();
  });

  it("Save twice saves once", async () => {
    const m = mount("distance", [
      listRoute(() => []),
      {
        method: "POST",
        path: /\/measurements$/,
        status: 201,
        body: {
          ...base,
          id: "d1",
          kind: "distance",
          name: "Distance 1",
          status: "ready",
          points: [],
          params: null,
          results: {},
        },
      },
    ]);
    await screen.findByTestId("measure-hint");
    m.tap([pick(E, N), pick(E + 3, N + 4)]);
    act(() => {
      m.tool().onCommit!();
      m.tool().onCommit!();
    });
    await waitFor(() => expect(posts(m.requests)).toHaveLength(1));
    // The save has settled (its row is listed): a second POST could only have been sent before it.
    await screen.findByRole("button", { name: /Distance 1/ });
    expect(posts(m.requests)).toHaveLength(1);
  });

  it("a refused save keeps the picks and says why", async () => {
    const m = mount("area", [
      listRoute(() => []),
      {
        method: "POST",
        path: /\/measurements$/,
        status: 422,
        body: errorBody(
          "measurement_limit",
          "this point cloud already has 1 000 measurements; delete one first",
        ),
      },
    ]);
    await screen.findByTestId("measure-hint");
    m.tap([pick(E, N), pick(E + 2, N), pick(E + 2, N + 2)]);
    act(() => m.tool().onCommit!());
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.text)).toContain(
        "this point cloud already has 1 000 measurements; delete one first",
      ),
    );
    expect(screen.getByTestId("measure-hint")).toHaveTextContent("3 vertices");
  });

  it("a click near the first vertex closes the outline and fills it", async () => {
    const m = mount("area", [listRoute(() => [])]);
    await screen.findByTestId("measure-hint");
    m.tap([pick(E, N), pick(E + 2, N), pick(E + 2, N + 2), pick(E + 0.01, N + 0.01)]);
    expect(screen.getByTestId("measure-hint")).toHaveTextContent("3 vertices · closed");
    const last = m.viewer.h.setOverlay.mock.calls.at(-1)!;
    expect(last[0]).toBe("measure");
    expect((last[1] as { kind: string }[]).map((s) => s.kind)).toContain("polygon");
  });

  it("the double-click close: a second click on the last vertex closes without adding a vertex", async () => {
    const m = mount("area", [listRoute(() => [])]);
    await screen.findByTestId("measure-hint");
    // W1 routes no double-click to tools: its two clicks arrive as picks, the second one on the last.
    m.tap([pick(E, N), pick(E + 2, N), pick(E + 2, N + 2), pick(E + 2.01, N + 2.01)]);
    expect(screen.getByTestId("measure-hint")).toHaveTextContent("3 vertices · closed");
    expect(m.tool().canCommit).toBe(true);
  });

  it("the double-click close on the first vertex: the second click keeps the closed outline", async () => {
    const m = mount("area", [listRoute(() => [])]);
    await screen.findByTestId("measure-hint");
    m.tap([
      pick(E, N),
      pick(E + 2, N),
      pick(E + 2, N + 2),
      pick(E + 0.01, N + 0.01),
      pick(E + 0.01, N + 0.01),
    ]);
    expect(screen.getByTestId("measure-hint")).toHaveTextContent("3 vertices · closed");
    // A click away from the outline still starts a new one (Ruling 4).
    m.tap([pick(E + 20, N + 20)]);
    expect(screen.getByTestId("measure-hint")).toHaveTextContent("1 vertex");
    expect(screen.getByTestId("measure-hint")).not.toHaveTextContent("closed");
  });

  it("a late slab preview for an earlier line never drops the current line's preview, and no line shows another's", async () => {
    const m = mount("section", [listRoute(() => [])]);
    await screen.findByTestId("measure-hint");
    const waiting: (() => void)[] = [];
    m.viewer.h.sampleSlab.mockImplementation(
      (a: number[], b: number[], thicknessM: number) =>
        new Promise((resolve) => {
          const count = waiting.length === 0 ? 7 : 3;
          waiting.push(() =>
            resolve({
              s: new Float64Array(count),
              z: new Float64Array(count),
              rgb: null,
              count,
              total: count,
              a,
              b,
              thicknessM,
            }),
          );
        }),
    );
    m.tap([pick(E, N, 5), pick(E + 12, N, 5)]); // line A: its answer comes last
    m.tap([pick(E, N + 30, 5), pick(E + 12, N + 30, 5)]); // line B
    expect(waiting).toHaveLength(2);
    await act(async () => waiting[1]());
    await waitFor(() => expect(panelProps.last?.data?.count).toBe(3));
    await act(async () => waiting[0]());
    await handled(seen.previews[0]);
    expect(panelProps.last?.data?.count).toBe(3);
    expect(panelProps.last?.line.a.y).toBe(N + 30);
    // A new line C while its sample is pending: B's preview is not C's section (the key gate).
    m.tap([pick(E, N + 60, 5), pick(E + 12, N + 60, 5)]);
    expect(waiting).toHaveLength(3);
    expect(panelProps.last?.line.a.y).toBe(N + 60);
    expect(panelProps.last?.data).toBeNull();
    await act(async () => waiting[2]());
    await waitFor(() => expect(panelProps.last?.data?.count).toBe(3));
  });

  it("Save as distance saves a distance and asks for its view capture", async () => {
    const m = mount("section", [
      listRoute(() => []),
      {
        method: "POST",
        path: /\/measurements$/,
        status: 201,
        body: {
          ...base,
          id: "d9",
          kind: "distance",
          name: "Distance 9",
          status: "ready",
          points: [],
          params: null,
          results: {},
        },
      },
    ]);
    await screen.findByTestId("measure-hint");
    m.tap([pick(E, N, 5), pick(E + 12, N, 5)]);
    await waitFor(() => expect(panelProps.last).not.toBeNull());
    const a = { x: E + 1, y: N, z: 5, uncertainty_m: 0.1 };
    const b = { x: E + 4, y: N, z: 6, uncertainty_m: 0.1 };
    act(() => panelProps.last!.onSaveDistance(a, b));
    await waitFor(() => expect(posts(m.requests)).toHaveLength(1));
    expect((posts(m.requests)[0] as unknown as { body: unknown }).body).toEqual({
      kind: "distance",
      points: [a, b],
    });
    await waitFor(() =>
      expect(m.seams.requestViewCapture).toHaveBeenCalledWith(
        { kind: "cloud_measurement", id: "d9" },
        "save",
      ),
    );
  });

  it("cross-section: preview, Save answers 202, then Full resolution after pointclouds.changed", async () => {
    const rows: Record<string, unknown>[] = [];
    const m = mount("section", [
      listRoute(() => rows),
      {
        method: "POST",
        path: /\/measurements$/,
        status: 202,
        body: (r) => {
          const b = r.body as { points: unknown[]; params: unknown };
          const row = {
            ...base,
            id: "p1",
            kind: "profile",
            name: "Cross-section 1",
            status: "computing",
            job_id: exampleJob.id,
            points: b.points,
            params: b.params,
            results: {},
          };
          rows.push(row);
          return { measurement: row, job: { ...exampleJob, type: "pointcloud_profile" } };
        },
      },
      {
        method: "GET",
        path: /\/measurements\/p1\/profile$/,
        body: { s: [0, 1, 2], z: [5, 6, 5], rgb: null, count: 3, thickness_m: 0.2, length_m: 12 },
      },
    ]);
    await screen.findByTestId("measure-hint");
    m.tap([pick(E, N, 5), pick(E + 12, N, 40)]);
    await waitFor(() =>
      expect(screen.getByTestId("profile-caption")).toHaveTextContent("Preview · display points"),
    );
    expect(m.viewer.h.sampleSlab).toHaveBeenCalledWith([E, N, 5], [E + 12, N, 5], 0.2, 300_000);
    expect(m.viewer.h.setClipBox).toHaveBeenCalledWith(
      expect.objectContaining({ yawDeg: 0 }),
      "highlight_inside",
    );
    await userEvent.click(within(screen.getByTestId("cloud-hintbar")).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(posts(m.requests)).toHaveLength(1));
    expect((posts(m.requests)[0] as unknown as { body: unknown }).body).toMatchObject({
      kind: "profile",
      params: { thickness_m: 0.2 },
    });
    await waitFor(() => expect(useJobsStore.getState().jobs[exampleJob.id]?.type).toBe("pointcloud_profile"));
    expect(m.seams.requestViewCapture).toHaveBeenCalledWith({ kind: "cloud_measurement", id: "p1" }, "save");
    expect(screen.getByTestId("profile-caption")).toHaveTextContent("Preview · display points");
    expect(m.feature().minimap).toEqual([{ kind: "line", a: [E, N], b: [E + 12, N] }]);
    rows[0] = {
      ...rows[0],
      status: "ready",
      updated_at: "2026-09-27T10:01:00Z",
      results: { profile_length_m: 12, profile_point_count: 3 },
    };
    act(() => useChangesStore.setState((s) => ({ pointcloudsRevision: s.pointcloudsRevision + 1 })));
    await waitFor(() =>
      expect(screen.getByTestId("profile-caption")).toHaveTextContent("Full resolution · 3 points"),
    );
  });

  it("a late profile answer for another row is dropped", async () => {
    const line = [
      { x: E, y: N, z: 5, uncertainty_m: 0.02 },
      { x: E + 12, y: N, z: 5, uncertainty_m: 0.02 },
    ];
    const row = (id: string) =>
      ({
        ...base,
        id,
        kind: "profile",
        name: `Section ${id}`,
        status: "ready",
        points: line,
        params: { thickness_m: 0.2 },
        results: {},
      }) as unknown as CloudMeasurement;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    // r1's profile answer is held back until r2 is chosen and shown.
    const slowR1 = (api: ApiClient): ApiClient =>
      ({
        ...api,
        GET: ((path: string, init: { params: { path: { cloudMeasurementId?: string } } }) =>
          path.endsWith("/profile") && init.params.path.cloudMeasurementId === "r1"
            ? gate.then(() => api.GET(path as never, init as never))
            : api.GET(path as never, init as never)) as ApiClient["GET"],
      }) as ApiClient;
    mount(
      "orbit",
      [
        listRoute(() => [row("r1"), row("r2")]),
        {
          method: "GET",
          path: /\/measurements\/r1\/profile$/,
          body: { s: [0, 1, 2], z: [5, 6, 5], rgb: null, count: 3, thickness_m: 0.2, length_m: 12 },
        },
        {
          method: "GET",
          path: /\/measurements\/r2\/profile$/,
          body: { s: [0, 1], z: [5, 6], rgb: null, count: 2, thickness_m: 0.2, length_m: 12 },
        },
      ],
      slowR1,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Section r1/ }));
    await userEvent.click(screen.getByRole("button", { name: /Section r2/ }));
    await waitFor(() =>
      expect(screen.getByTestId("profile-caption")).toHaveTextContent("Full resolution · 2 points"),
    );
    release();
    await handled(seen.profiles.get("r1"));
    expect(screen.getByTestId("profile-caption")).toHaveTextContent("Full resolution · 2 points");
  });

  it("rings: N moves to the upper ring, Backspace removes the last pick", async () => {
    const m = mount("vertical", [listRoute(() => [])]);
    await userEvent.click(await screen.findByRole("radio", { name: "Rings" }));
    m.tap([pick(E + 1, N, 0), pick(E, N + 1, 0), pick(E - 1, N, 0)]);
    let consumed = false;
    act(() => {
      consumed = m.tool().onAction!("next-ring");
    });
    expect(consumed).toBe(true);
    m.tap([pick(E + 1, N, 10)]);
    expect(screen.getByTestId("measure-hint")).toHaveTextContent("lower 3 · upper 1");
    act(() => m.tool().onRemoveVertex!());
    expect(screen.getByTestId("measure-hint")).toHaveTextContent("lower 3 · upper 0");
  });

  it("the first Esc drops the picks and puts the section slab away; with no picks it lets W1 go to Orbit", async () => {
    const m = mount("section", [listRoute(() => [])]);
    await screen.findByTestId("measure-hint");
    m.tap([pick(E, N, 5), pick(E + 12, N, 40)]);
    await waitFor(() => expect(m.viewer.h.setClipBox).toHaveBeenCalled());
    let dropped = false;
    act(() => {
      dropped = m.tool().onCancel!();
    });
    expect(dropped).toBe(true);
    expect(m.restoreClipBox).toHaveBeenCalled();
    expect(screen.queryByTestId("profile-panel")).toBeNull();
    act(() => {
      dropped = m.tool().onCancel!();
    });
    expect(dropped).toBe(false);
  });

  it("an armed tool with no picks shows the saved row: after Save the outline and its label stay", async () => {
    const rows: unknown[] = [];
    const m = mount("area", [
      listRoute(() => rows),
      {
        method: "POST",
        path: /\/measurements$/,
        status: 201,
        body: (r) => {
          const b = r.body as object;
          const row = {
            ...base,
            id: "a2",
            kind: "area",
            name: "Area 2",
            status: "ready",
            ...b,
            results: { area_m2: 4 },
          };
          rows.push(row);
          return row;
        },
      },
    ]);
    await screen.findByTestId("measure-hint");
    m.tap([pick(E, N), pick(E + 2, N), pick(E + 2, N + 2), pick(E, N + 2)]);
    act(() => m.tool().onCommit!());
    await waitFor(() => expect(screen.getByTestId("measure-hint")).toHaveTextContent("0 vertices"));
    await waitFor(() => expect(lastOverlay(m.viewer.h).map((x) => x.kind)).toContain("polygon"));
    expect(screen.getByTestId("measure-label")).toHaveTextContent("4.00 m²");
  });

  it("choosing a row while a tool is armed draws that row", async () => {
    const row = {
      ...base,
      id: "d5",
      kind: "distance",
      name: "Distance 5",
      status: "ready",
      points: [
        { x: E, y: N, z: 0, uncertainty_m: 0.02 },
        { x: E + 3, y: N + 4, z: 0, uncertainty_m: 0.02 },
      ],
      params: null,
      results: { distance_3d: 5, distance_vertical: 0 },
    };
    const m = mount("distance", [listRoute(() => [row])]);
    await userEvent.click(await screen.findByRole("button", { name: /Distance 5/ }));
    await waitFor(() =>
      expect(
        lastOverlay(m.viewer.h)
          .flatMap((x) => x.points)
          .some((p) => p.x === E + 3 && p.y === N + 4),
      ).toBe(true),
    );
    expect(screen.getByTestId("measure-label")).toBeInTheDocument();
  });

  it("Save as distance from a saved profile keeps the panel on that profile", async () => {
    const m = mount("orbit", [
      listRoute(() => [savedProfile("r1", "ready")]),
      { method: "GET", path: /\/measurements\/r1\/profile$/, body: profileBody },
      {
        method: "POST",
        path: /\/measurements$/,
        status: 201,
        body: {
          ...base,
          id: "d7",
          kind: "distance",
          name: "Distance 7",
          status: "ready",
          points: [],
          params: null,
          results: {},
        },
      },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: /Section r1/ }));
    await waitFor(() =>
      expect(screen.getByTestId("profile-caption")).toHaveTextContent("Full resolution · 3 points"),
    );
    act(() =>
      panelProps.last!.onSaveDistance(
        { x: E + 1, y: N, z: 5, uncertainty_m: 0.1 },
        { x: E + 4, y: N, z: 6, uncertainty_m: 0.1 },
      ),
    );
    await waitFor(() =>
      expect(m.seams.requestViewCapture).toHaveBeenCalledWith(
        { kind: "cloud_measurement", id: "d7" },
        "save",
      ),
    );
    expect(screen.getByTestId("profile-panel")).toBeInTheDocument();
    expect(screen.getByTestId("profile-caption")).toHaveTextContent("Full resolution · 3 points");
    expect(screen.getByRole("button", { name: /Section r1/ })).toHaveAttribute("aria-pressed", "true");
    expect(m.restoreClipBox).not.toHaveBeenCalled();
  });

  it("puts the section slab back when the view restarts", async () => {
    const m = mount("section", [listRoute(() => [])]);
    await screen.findByTestId("measure-hint");
    m.tap([pick(E, N, 5), pick(E + 12, N, 5)]);
    await waitFor(() => expect(m.viewer.h.setClipBox).toHaveBeenCalledTimes(1));
    act(() => m.setViewState("lost"));
    expect(m.restoreClipBox).toHaveBeenCalledTimes(1);
    act(() => m.setViewState("running"));
    expect(m.viewer.h.setClipBox).toHaveBeenCalledTimes(2);
    expect(m.viewer.h.setClipBox).toHaveBeenLastCalledWith(
      expect.objectContaining({ yawDeg: 0 }),
      "highlight_inside",
    );
  });

  it("choosing a computing profile row while a section is drawn keeps the draft's preview", async () => {
    const m = mount("section", [listRoute(() => [savedProfile("c1", "computing", N + 50)])]);
    await screen.findByTestId("measure-hint");
    m.tap([pick(E, N, 5), pick(E + 12, N, 5)]);
    await waitFor(() => expect(panelProps.last?.data?.count).toBe(3));
    await userEvent.click(screen.getByRole("button", { name: /Section c1/ }));
    // Choosing samples synchronously, if at all: once the row shows chosen, the call would be in.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Section c1/ })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(m.viewer.h.sampleSlab).toHaveBeenCalledTimes(1);
    expect(panelProps.last?.line.a.y).toBe(N);
    expect(panelProps.last?.data?.count).toBe(3);
  });

  it("a ready row whose stored profile cannot be read falls back to the preview", async () => {
    const m = mount("orbit", [
      listRoute(() => [savedProfile("r3", "ready", N + 20)]),
      {
        method: "GET",
        path: /\/measurements\/r3\/profile$/,
        status: 500,
        body: errorBody("internal", "profile file missing"),
      },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: /Section r3/ }));
    await waitFor(() =>
      expect(m.viewer.h.sampleSlab).toHaveBeenCalledWith([E, N + 20, 5], [E + 12, N + 20, 5], 0.2, 300_000),
    );
    await waitFor(() => expect(panelProps.last?.data?.count).toBe(3));
    expect(useToastStore.getState().toasts.map((t) => t.text)).toContain("profile file missing");
  });

  it("Enter on an open bow-tie refuses without closing it, so the next click corrects it", async () => {
    const m = mount("area", [listRoute(() => [])]);
    await screen.findByTestId("measure-hint");
    m.tap([pick(E, N), pick(E + 2, N + 2), pick(E + 2, N), pick(E, N + 2)]);
    act(() => m.tool().onCommit!());
    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0));
    expect(screen.getByTestId("measure-hint")).toHaveTextContent("4 vertices");
    expect(screen.getByTestId("measure-hint")).not.toHaveTextContent("closed");
    expect(posts(m.requests)).toHaveLength(0);
    m.tap([pick(E - 3, N + 5)]);
    expect(screen.getByTestId("measure-hint")).toHaveTextContent("5 vertices");
  });

  it("arms nothing and draws no label outside the measure tools", async () => {
    const m = mount("orbit", [listRoute(() => [])]);
    await screen.findByRole("list", { name: "Saved measurements" });
    expect(screen.queryByTestId("measure-hint")).toBeNull();
    expect(m.feature().layer).toBeUndefined();
  });
});
