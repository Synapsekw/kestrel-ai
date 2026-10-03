import * as THREE from "three";
import { useState } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetModelGlbUrl, type ApiClient } from "@contract/client";
import { renderWithDataRouter } from "@/test/dataRouter";
import { fakeClient } from "@/test/fixtures";
import { VERSION_2 } from "@/test/assetModelFixtures";
import { fakeSiteControls } from "@/test/fakeSiteControls";
import { CATALOGUE, ITEM, PUMP, itemRow, plantModel, plantSpec } from "@/test/plantFixtures";
import { FRAME, sceneWith } from "@/test/siteSceneFixtures";
import { useJobsStore } from "@/store/jobs";
import type { ExtraLayerRow, ExtraLayers } from "@/site3d/layers/useSiteExtraLayers";
import type { SiteLayer } from "@/site3d/layers/types";
import { SitePanels, rowBox, type SiteModelView } from "./SitePanels";

const JOB = {
  id: "j1",
  project_id: "p",
  type: "asset_model_glb",
  state: "queued",
  progress: 0,
  message: "",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-10-03T09:00:00Z",
  started_at: null,
  finished_at: null,
};
const scene = sceneWith({
  model: { id: "m1", version: 3, glb_url: "/g/3.glb", csv_url: "/g/3.csv", kind: "plant" } as never,
});
const extraRow = (
  id: string,
  label: string,
  group: ExtraLayerRow["group"],
  visible: boolean,
  status: unknown,
) => ({ id, label, group, visible, layer: { status: { get: () => status } } }) as unknown as ExtraLayerRow;
const extra = (rows: ExtraLayerRow[] = []): ExtraLayers => ({
  rows,
  setVisible: vi.fn(),
  cloudColour: "rgb",
  setCloudColour: vi.fn(),
  budget: 3_000_000,
  setBudget: vi.fn(),
  photos: null,
  findings: null,
});
const layerOf = (id: string, label: string, opacity = false) =>
  ({
    id,
    label,
    attach() {},
    detach() {},
    setVisible: vi.fn(),
    ...(opacity ? { setOpacity: vi.fn() } : {}),
  }) as unknown as SiteLayer;

function routes(extraRoutes: unknown[] = []) {
  return [
    ...extraRoutes,
    { method: "GET", path: /\/asset-models$/, body: { items: [plantModel()] } },
    {
      method: "GET",
      path: /\/versions\/3\/items$/,
      body: {
        items: [itemRow(), itemRow({ node: PUMP.id, tag: PUMP.tag, name: PUMP.name })],
        next_cursor: null,
      },
    },
    { method: "GET", path: /\/versions\/3\/items\/20-T-0001$/, body: ITEM },
    { method: "GET", path: /\/versions\/3\/items\/30-P-0001$/, body: PUMP },
    { method: "GET", path: /\/asset-models\/catalogue$/, body: { types: CATALOGUE } },
    {
      method: "GET",
      path: /\/asset-models\/m1\/versions\/3$/,
      body: { ...VERSION_2, version: 3, spec: plantSpec(), warnings: [] },
    },
    {
      method: "POST",
      path: /\/asset-models\/m1\/versions$/,
      status: 201,
      body: { version: { ...VERSION_2, version: 4 }, job: JOB },
    },
  ];
}

/**
 * SiteScreen's part of the swap, played by hand: `onShowVersion` changes the view's GLB URL, and the
 * (fake) view's load settles the model status (ruling R-S3-10: SiteView is the one swap path).
 */
function Harness(p: {
  controls: ReturnType<typeof fakeSiteControls>["controls"];
  extra: ExtraLayers;
  s1Layers: SiteLayer[];
  load: (url: string) => Promise<void>;
  gone: ReadonlySet<string>;
}) {
  const [view, setView] = useState<SiteModelView>({ version: 3, shown: 3, state: "ready", items: 2 });
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const show = (v: number) => {
    setView((s) => ({ ...s, version: v, state: "loading" }));
    p.load(assetModelGlbUrl("http://fake", "t", "p", "m1", v)).then(
      () => setView({ version: v, shown: v, state: "ready", items: 2 }),
      (e: Error) => setView((s) => ({ ...s, state: "error", error: e.message })),
    );
  };
  return (
    <SitePanels
      projectId="p"
      scene={scene}
      frame={FRAME}
      controls={p.controls}
      s1Layers={p.s1Layers}
      extra={p.extra}
      view={view}
      onShowVersion={show}
      hidden={hidden}
      onHidden={(id, h) =>
        setHidden((prev) => {
          const next = new Set(prev);
          if (h) next.add(id);
          else next.delete(id);
          return next;
        })
      }
      gone={p.gone}
    />
  );
}

function mount(
  o: {
    controls?: ReturnType<typeof fakeSiteControls>;
    url?: string;
    routes?: unknown[];
    load?: (url: string) => Promise<void>;
    extra?: ExtraLayers;
    s1Layers?: SiteLayer[];
    gone?: ReadonlySet<string>;
  } = {},
) {
  const c = o.controls ?? fakeSiteControls();
  const client = fakeClient(routes(o.routes) as never, { signalSafe: true });
  const x = o.extra ?? extra();
  const load = o.load ?? vi.fn(async () => {});
  const modelLayer = layerOf("model", "Plant model", true);
  const r = renderWithDataRouter(
    <Harness
      controls={c.controls}
      extra={x}
      s1Layers={o.s1Layers ?? [modelLayer]}
      load={load}
      gone={o.gone ?? new Set()}
    />,
    { api: client.api as ApiClient, route: o.url ?? "/p/p/site/m1", path: "/p/:projectId/site/:modelId" },
  );
  return { ...client, ...r, c, x, load, modelLayer };
}
const openTank = async () => fireEvent.click(await screen.findByRole("button", { name: /20-T-0001/ }));
const editTop = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(await screen.findByLabelText(/^top el/i), { target: { value: "140" } });
};
const itemReads = (requests: { method: string; url: string }[], id: string) =>
  requests.filter((q) => q.method === "GET" && q.url.includes(`/items/${id}`)).length;

describe("SitePanels", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("a register row flies to its item, selects it and opens it", async () => {
    const box = new THREE.Box3(new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6));
    const controls = fakeSiteControls({ boxOf: vi.fn(() => box) });
    mount({ controls });
    await openTank();
    expect(controls.raw.flyTo).toHaveBeenCalledWith(box);
    expect(controls.raw.select).toHaveBeenCalledWith("20-T-0001");
    expect(await screen.findByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
  });

  it("a click on an item in 3D opens it", async () => {
    const { c } = mount();
    await screen.findByRole("button", { name: /20-T-0001/ });
    act(() => c.emitSelect("30-P-0001"));
    expect(await screen.findByRole("heading", { name: "Send-out pump 1" })).toBeInTheDocument();
  });

  it("edit → new version → the GLB swaps in, keeping the camera", async () => {
    const { load } = mount();
    await openTank();
    await editTop();
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    expect(await screen.findByText(/building version 4/i)).toBeInTheDocument();
    act(() => useJobsStore.getState().upsert({ ...JOB, state: "succeeded", progress: 1 } as never));
    await waitFor(() => expect(load).toHaveBeenCalledWith(expect.stringContaining("/versions/4/glb")));
    expect(await screen.findByText("Version 4")).toBeInTheDocument();
    expect(screen.queryByText(/building version 4/i)).toBeNull();
  });

  it("a failed swap keeps the old model, labelled stale, and says why", async () => {
    const load = vi.fn(async () => {
      throw new Error("GLB parse failed");
    });
    mount({ load });
    await openTank();
    await editTop();
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    await screen.findByText(/building version 4/i);
    act(() => useJobsStore.getState().upsert({ ...JOB, state: "succeeded", progress: 1 } as never));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Version 4's 3D model could not load.");
    expect(alert).toHaveTextContent("Stale");
    expect(alert).toHaveTextContent("You are seeing version 3.");
    expect(alert).toHaveTextContent("GLB parse failed");
    expect(screen.getByText("Version 3")).toBeInTheDocument();
    // S3-9 minor 2: the Plant model row says stale too, not "Could not load".
    const layers = screen.getByRole("region", { name: "Layers" });
    expect(
      within(layers).getByText("Stale: showing version 3. Version 4 could not load."),
    ).toBeInTheDocument();
    expect(within(layers).queryByText("Could not load")).toBeNull();
  });

  it("a build job that fails says so and keeps the version on screen", async () => {
    const { load } = mount();
    await openTank();
    await editTop();
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    await screen.findByText(/building version 4/i);
    act(() => useJobsStore.getState().upsert({ ...JOB, state: "failed", error: "mesh failed" } as never));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Version 4's 3D model could not load.");
    expect(alert).toHaveTextContent("You are seeing version 3.");
    expect(load).not.toHaveBeenCalled();
  });

  it("unsaved edits ask before another item opens", async () => {
    const { c } = mount();
    await openTank();
    await editTop();
    act(() => c.emitSelect("30-P-0001"));
    expect(await screen.findByRole("dialog", { name: /discard your changes/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText(/^top el/i)).toHaveValue(140);
  });

  it("unsaved edits ask before Cancel drops them (S3-9 minor 4)", async () => {
    mount();
    await openTank();
    await editTop();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("dialog", { name: /discard your changes/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
  });

  it("the editor edits the version on screen, and a save clears the unsaved state before leaving (S3-9 minor 4)", async () => {
    const { requests, router } = mount();
    await openTank();
    await editTop();
    expect(screen.getByText(/editing from version/i)).toHaveTextContent("Editing from version 3.");
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    await screen.findByText(/building version 4/i);
    // the item came from the base version (3), and the save read the base version's spec
    const reads = requests.filter((q) => q.method === "GET" && q.url.includes("/items/20-T-0001"));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((q) => q.url.includes("/versions/3/"))).toBe(true);
    expect(requests.some((q) => q.method === "GET" && /\/versions\/3$/.test(q.url))).toBe(true);
    await act(() => router.navigate("/elsewhere"));
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a register pick that the engine echoes back opens the item once, without a loop (S3-9 minor 3)", async () => {
    // Like S1's ModelLayer.select: the selection is re-broadcast to every onSelect listener.
    const listeners = new Set<(n: string | null) => void>();
    const controls = fakeSiteControls({
      onSelect: vi.fn((cb: (n: string | null) => void) => {
        listeners.add(cb);
        return () => void listeners.delete(cb);
      }),
      select: vi.fn((n: string | null) => listeners.forEach((cb) => cb(n))),
    });
    const { requests } = mount({ controls });
    await openTank();
    expect(await screen.findByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
    expect(controls.raw.select).toHaveBeenCalledTimes(1);
    expect(controls.raw.flyTo).toHaveBeenCalledTimes(1);
    expect(itemReads(requests, "20-T-0001")).toBe(1);
    // Back to the register clears the 3D selection once, and the echo does not reopen anything.
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(controls.raw.select).toHaveBeenLastCalledWith(null);
    expect(await screen.findByRole("button", { name: /20-T-0001/ })).toBeInTheDocument();
  });

  it("a selection cleared in 3D (a swap that dropped the item) returns to the register (S3-9 minor 1)", async () => {
    const { c } = mount();
    await openTank();
    await screen.findByRole("heading", { name: "LNG tank 1" });
    act(() => c.emitSelect(null));
    expect(await screen.findByRole("button", { name: /20-T-0001/ })).toBeInTheDocument();
  });

  it("an ?at= arrival in the site's CRS flies there once; another CRS is ignored", async () => {
    const a = fakeSiteControls();
    mount({ controls: a, url: `/p/p/site/m1?at=${FRAME.origin_crs[0]},${FRAME.origin_crs[1]}&epsg=32639` });
    await waitFor(() => expect(a.raw.flyTo).toHaveBeenCalledTimes(1));
    const centre = (vi.mocked(a.raw.flyTo).mock.calls[0] as unknown as [THREE.Box3])[0].getCenter(
      new THREE.Vector3(),
    );
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.z).toBeCloseTo(0, 6);
  });

  it("an ?at= arrival in another CRS, or with no CRS, opens framed (no fly)", async () => {
    const b = fakeSiteControls();
    mount({ controls: b, url: "/p/p/site/m1?at=500000,4000000&epsg=32633" });
    await screen.findByRole("button", { name: /20-T-0001/ });
    expect(b.raw.flyTo).not.toHaveBeenCalled();
  });

  it("an ?at= arrival with no EPSG (the map's pixel frame) opens framed", async () => {
    const b = fakeSiteControls();
    mount({ controls: b, url: `/p/p/site/m1?at=${FRAME.origin_crs[0]},${FRAME.origin_crs[1]}` });
    await screen.findByRole("button", { name: /20-T-0001/ });
    expect(b.raw.flyTo).not.toHaveBeenCalled();
  });

  it("the layer switches reach S1's layers and S2's rows", async () => {
    const x = extra([extraRow("sky", "Sky", "Environment", true, { kind: "ready" })]);
    const { modelLayer } = mount({ extra: x });
    fireEvent.click(await screen.findByRole("switch", { name: "Plant model" }));
    expect(modelLayer.setVisible).toHaveBeenCalledWith(false);
    expect(x.setVisible).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Plant model" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("switch", { name: "Sky" }));
    expect(x.setVisible).toHaveBeenCalledWith("sky", false);
  });

  it("a removed map greys its row; photos start off (S3-9 minors 7 and 8)", async () => {
    const ortho = layerOf("ortho:o1", "May ortho", true);
    const x = extra([extraRow("photos", "Photos", "Data", false, { kind: "ready" })]);
    mount({
      s1Layers: [layerOf("model", "Plant model", true), ortho],
      gone: new Set(["ortho:o1"]),
      extra: x,
    });
    const layers = await screen.findByRole("region", { name: "Layers" });
    expect(within(layers).getByRole("switch", { name: "May ortho" })).toBeDisabled();
    expect(within(layers).getByText("This map was removed.")).toBeInTheDocument();
    expect(within(layers).getByRole("switch", { name: "Photos" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("rowBox", () => {
  it("boxes 30 m around a row's plant point, from base to top", () => {
    const b = rowBox(FRAME, itemRow({ plant_e: 0, plant_n: 0, base_el: 100, top_el: 135 }))!;
    expect(b.max.x - b.min.x).toBeCloseTo(30, 6);
    expect(b.max.y - b.min.y).toBeCloseTo(35, 6);
    expect(rowBox(FRAME, itemRow({ plant_e: null, plant_n: null }))).toBeNull();
  });
});
