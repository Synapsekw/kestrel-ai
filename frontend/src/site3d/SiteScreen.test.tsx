import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { renderWithDataRouter } from "@/test/dataRouter";
import { fakeClient } from "@/test/fixtures";
import { VERSION_2 } from "@/test/assetModelFixtures";
import { CATALOGUE, ITEM, itemRow, plantModel, plantSpec } from "@/test/plantFixtures";
import { EMPTY_SCENE, FRAME_ONLY_SCENE, MODEL_SCENE, TILE_SCENE } from "@/test/siteSceneFixtures";
import { useJobsStore } from "@/store/jobs";
import type { SiteScene } from "@/api/siteScene";
import type { PickHit, SiteLayer } from "./layers/types";

const h = vi.hoisted(() => ({
  engines: [] as Array<{
    layers: Map<string, SiteLayer>;
    addLayer: (l: SiteLayer) => void;
    removeLayer: (id: string) => void;
    select: (hit: PickHit | null) => void;
    setPreset: (id: string) => void;
    setNav: (m: string) => void;
    onSelect: (cb: (hit: PickHit | null) => void) => () => void;
    dispose: () => void;
  }>,
  models: [] as Array<{
    id: string;
    opts: {
      url: string;
      onLoad?: (i: unknown, u?: string) => void;
      onError?: (e: unknown, u?: string) => void;
    };
    setVisible: (v: boolean) => void;
    load: ReturnType<typeof vi.fn>;
  }>,
  fail: null as Error | null,
}));

// S2's layers read the engine's three objects (R-S2-9): real ones, no WebGL. This fake never attaches.
vi.mock("@/site3d/engine/create", async () => {
  const THREE = await import("three");
  return {
    createSiteEngine: () => {
      if (h.fail) throw h.fail;
      let cb: ((hit: PickHit | null) => void) | null = null;
      const layers = new Map<string, SiteLayer>();
      const e = {
        layers,
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        canvas: document.createElement("canvas"),
        renderer: { info: { render: { frame: 0 } } },
        requestRender: vi.fn(),
        addLayer: vi.fn((l: SiteLayer) => layers.set(l.id, l)),
        removeLayer: vi.fn((id: string) => layers.delete(id)),
        select: vi.fn((hit: PickHit | null) => cb?.(hit)),
        setPreset: vi.fn(),
        setNav: vi.fn(),
        onSelect: (f: (hit: PickHit | null) => void) => {
          cb = f;
          return () => (cb = null);
        },
        dispose: vi.fn(),
      };
      h.engines.push(e);
      return e;
    },
  };
});

vi.mock("@/site3d/layers/model.layer", () => ({
  MODEL_LAYER_ID: "model",
  createModelLayer: (opts: {
    url: string;
    onLoad?: (i: unknown, u: string) => void;
    onError?: (e: unknown, u: string) => void;
  }) => {
    const l = {
      id: "model",
      label: "Plant model",
      url: opts.url,
      // the tests report for the layer's first URL unless they name another
      opts: {
        url: opts.url,
        onLoad: (i: unknown, u = opts.url) => opts.onLoad?.(i, u),
        onError: (e: unknown, u = opts.url) => opts.onError?.(e, u),
      },
      attach: vi.fn(),
      detach: vi.fn(),
      setVisible: vi.fn(),
      load: vi.fn(async (u: string) => {
        l.url = u;
      }),
      // S1's ModelLayer.select: a broadcast through the engine, as a click would make
      select: vi.fn((id: string | null) =>
        h.engines.at(-1)?.select(id ? { layerId: "model", itemId: id, point: [0, 0, 0], extras: {} } : null),
      ),
      itemBox: vi.fn(() => null),
      setColourBy: vi.fn(),
      setOpacity: vi.fn(),
    };
    h.models.push(l);
    return l;
  },
}));

import { SiteScreen } from "./SiteScreen";

const JOB = {
  id: "j1",
  project_id: "p1",
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
const GLB = (v: number) => `http://fake/api/v1/projects/p1/asset-models/m1/versions/${v}/glb?token=t`;

/** The plant model's reads behind the panels (register, item, catalogue, the base version, a save). */
const PLANT_ROUTES = [
  { method: "GET", path: /\/asset-models$/, body: { items: [plantModel({ current_version: 1 })] } },
  { method: "GET", path: /\/versions\/\d+\/items$/, body: { items: [itemRow()], next_cursor: null } },
  { method: "GET", path: /\/versions\/1\/items\/20-T-0001$/, body: ITEM },
  { method: "GET", path: /\/asset-models\/catalogue$/, body: { types: CATALOGUE } },
  {
    method: "GET",
    path: /\/asset-models\/m1\/versions\/1$/,
    body: { ...VERSION_2, version: 1, spec: plantSpec(), warnings: [] },
  },
  {
    method: "POST",
    path: /\/asset-models\/m1\/versions$/,
    status: 201,
    body: { version: { ...VERSION_2, version: 2 }, job: JOB },
  },
];

function open(scene: SiteScene | (() => SiteScene) | { status: number }, route = "/p/p1/site") {
  const { api } = fakeClient([
    typeof scene !== "function" && "status" in scene
      ? {
          method: "GET",
          path: /\/site-scene/,
          status: scene.status,
          body: { error: { code: "boom", message: "The server failed", details: {} } },
        }
      : { method: "GET", path: /\/site-scene/, body: typeof scene === "function" ? () => scene() : scene },
    ...PLANT_ROUTES,
  ] as never);
  return renderWithDataRouter(<SiteScreen />, { api, route, path: "/p/:projectId/site/:modelId?" });
}

/**
 * The canvas is in the DOM one commit before the engine exists: the engine is made in SiteView's
 * passive effect, which React flushes in a later task than the commit. `findBy*` resolves on the
 * commit, so wait for the engine too before reading `h.engines` or `h.models`.
 */
async function viewStarted() {
  await screen.findByTestId("site-canvas");
  await waitFor(() => expect(h.engines.length).toBeGreaterThan(0));
}
const layersPanel = () => screen.getByRole("region", { name: "Layers" });

const TANK: PickHit = {
  layerId: "model",
  itemId: "20-T-0001",
  point: [0, 30, 0],
  extras: { name: "LNG tank 1", tag: "20-T-0001", type: "tank_lng", area: "20" },
};
const ITEMS = { items: 2, areas: ["20"], types: ["pipe_rack", "tank_lng"] };

describe("SiteScreen", () => {
  beforeEach(() => {
    h.engines.length = 0;
    h.models.length = 0;
    h.fail = null;
    useJobsStore.setState({ jobs: {} });
  });

  it("no frame: says nothing is placed, points at a plant model, makes no canvas (Review Focus 1)", async () => {
    open(EMPTY_SCENE);
    expect(await screen.findByText("Nothing to place yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a plant model" })).toHaveAttribute("href", "/p/p1/models");
    expect(screen.queryByTestId("site-canvas")).toBeNull();
    expect(h.engines).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("no model: the Plant model row is off saying why, and the build card can be dismissed (Review Focus 1)", async () => {
    open(FRAME_ONLY_SCENE);
    expect(await screen.findByText("No plant model yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a plant model" })).toBeInTheDocument();
    expect(screen.getByTestId("site-canvas")).toBeInTheDocument();
    await waitFor(() => expect(h.engines).toHaveLength(1));
    expect(within(layersPanel()).getByRole("switch", { name: "Plant model" })).toBeDisabled();
    expect(layersPanel()).toHaveTextContent("None yet");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Plant register" })).toBeNull();
    expect(h.models).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("No plant model yet")).toBeNull();
  });

  it("a model loads with the token-bearing URL, counts its items, and a pick opens the item", async () => {
    open(MODEL_SCENE, "/p/p1/site/m1");
    await viewStarted();
    expect(h.models[0].opts.url).toBe(GLB(1));
    // S1's loading pill folded into the Plant model row (R-S3-17).
    expect(layersPanel()).toHaveTextContent("Loading");
    act(() => h.models[0].opts.onLoad?.(ITEMS));
    expect(await within(layersPanel()).findByText("2 items")).toBeInTheDocument();
    const register = screen.getByRole("complementary", { name: "Plant register" });
    expect(within(register).getByText("Version 1")).toBeInTheDocument();
    expect(await within(register).findByRole("button", { name: /20-T-0001/ })).toBeInTheDocument();
    act(() => h.engines[0].select(TANK));
    expect(await screen.findByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(screen.queryByRole("heading", { name: "LNG tank 1" })).toBeNull();
  });

  it("a model that fails to load says so and offers a reload (Review Focus 3)", async () => {
    open(MODEL_SCENE);
    await viewStarted();
    act(() => h.models[0].opts.onError?.(new Error("409")));
    expect(await screen.findByText("The plant model could not load.")).toBeInTheDocument();
    expect(layersPanel()).toHaveTextContent("Could not load");
    await userEvent.click(screen.getByRole("button", { name: "Reload view" }));
    expect(h.engines.length).toBe(2);
    expect(h.engines[0].dispose).toHaveBeenCalled();
    // The retry shows: the alert goes, the row reads loading again (ruling R-S1-24).
    expect(screen.queryByText("The plant model could not load.")).toBeNull();
    expect(layersPanel()).toHaveTextContent("Loading");
    // A second failure shows the alert again.
    act(() => h.models[1].opts.onError?.(new Error("409")));
    expect(await screen.findByText("The plant model could not load.")).toBeInTheDocument();
  });

  it("a reloaded view drops the stale selection", async () => {
    open(MODEL_SCENE);
    await viewStarted();
    act(() => h.models[0].opts.onError?.(new Error("409")));
    act(() => h.engines[0].select(TANK));
    expect(await screen.findByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload view" }));
    expect(screen.queryByRole("heading", { name: "LNG tank 1" })).toBeNull();
  });

  it("Escape clears the selection unless something else handled it", async () => {
    open(MODEL_SCENE);
    await viewStarted();
    act(() => h.engines[0].select(TANK));
    await screen.findByRole("heading", { name: "LNG tank 1" });
    const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    handled.preventDefault();
    act(() => void window.dispatchEvent(handled));
    expect(screen.getByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("heading", { name: "LNG tank 1" })).toBeNull();
    expect(await screen.findByRole("button", { name: /20-T-0001/ })).toBeInTheDocument();
  });

  it("a saved edit swaps the GLB in place; a failed swap keeps the old model, stale (Review Focus 5)", async () => {
    open(MODEL_SCENE, "/p/p1/site/m1");
    await viewStarted();
    act(() => h.models[0].opts.onLoad?.(ITEMS));
    act(() => h.engines[0].select(TANK));
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const top = await screen.findByLabelText(/^top el/i);
    await userEvent.clear(top);
    await userEvent.type(top, "140");
    await userEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    expect(await screen.findByText(/building version 2/i)).toBeInTheDocument();
    act(() => useJobsStore.getState().upsert({ ...JOB, state: "succeeded", progress: 1 } as never));
    // R-S3-10: one swap path, the same layer loads the new URL (no new layer, the camera stays).
    await waitFor(() => expect(h.models[0].load).toHaveBeenCalledWith(GLB(2)));
    expect(h.models).toHaveLength(1);
    // three's FileLoader names the token-bearing URL it fetched; none of it may reach the screen.
    const leaky = Object.assign(new Error(`fetch for "${GLB(2)}" responded with 404: Not Found`), {
      response: { status: 404 },
    });
    act(() => h.models[0].opts.onError?.(leaky, GLB(2)));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Version 2's 3D model could not load.");
    expect(alert).toHaveTextContent("You are seeing version 1. The 3D model could not load (HTTP 404).");
    expect(layersPanel()).toHaveTextContent("Stale: showing version 1. Version 2 could not load.");
    expect(screen.queryByText("The plant model could not load.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload view" })).toBeNull();
    const page = screen.getByTestId("site-screen").textContent ?? "";
    // case-sensitive: "Not Found" is the HTTP status text; the flag filter says "Not found in the scan"
    expect(page).not.toMatch(/token|https?:\/\/|\/glb|Not Found/);

    // Dismissing the failed swap goes back to the last good version: the stale label goes, and the
    // view asks the one swap path for version 1 again.
    await userEvent.click(within(alert).getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(h.models[0].load).toHaveBeenLastCalledWith(GLB(1)));
    act(() => h.models[0].opts.onLoad?.(ITEMS, GLB(1)));
    await waitFor(() => expect(layersPanel()).not.toHaveTextContent("Stale"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      within(screen.getByRole("complementary", { name: "Plant register" })).getByText("Version 1"),
    ).toBeInTheDocument();
  });

  it("a newer manifest version beats a saved edit's version: the view never pins (fix round 1)", async () => {
    let manifest = 1;
    open(() => ({ ...MODEL_SCENE, model: { ...MODEL_SCENE.model!, version: manifest } }), "/p/p1/site/m1");
    await viewStarted();
    act(() => h.models[0].opts.onLoad?.(ITEMS));
    act(() => h.engines[0].select(TANK));
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const top = await screen.findByLabelText(/^top el/i);
    await userEvent.clear(top);
    await userEvent.type(top, "140");
    await userEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    await screen.findByText(/building version 2/i);
    // the job ends; the manifest (still version 1 here) is read again, and the saved version 2 shows
    act(() => useJobsStore.getState().upsert({ ...JOB, state: "succeeded", progress: 1 } as never));
    await waitFor(() => expect(h.models[0].load).toHaveBeenCalledWith(GLB(2)));
    act(() => h.models[0].opts.onLoad?.(ITEMS, GLB(2)));
    const register = screen.getByRole("complementary", { name: "Plant register" });
    expect(await within(register).findByText("Version 2")).toBeInTheDocument();
    // a later rebuild: the manifest names version 5, which wins over the saved 2
    manifest = 5;
    act(() => useJobsStore.getState().upsert({ ...JOB, id: "j2", state: "queued" } as never));
    act(() => useJobsStore.getState().upsert({ ...JOB, id: "j2", state: "succeeded", progress: 1 } as never));
    await waitFor(() => expect(h.models[0].load).toHaveBeenCalledWith(GLB(5)));
    act(() => h.models[0].opts.onLoad?.(ITEMS, GLB(5)));
    expect(await within(register).findByText("Version 5")).toBeInTheDocument();
  });

  it("an unknown model id links back to the project's site", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/site-scene/,
        status: 404,
        body: { error: { code: "not_found", message: "No such plant model", details: {} } },
      },
    ]);
    renderWithDataRouter(<SiteScreen />, {
      api,
      route: "/p/p1/site/zz",
      path: "/p/:projectId/site/:modelId?",
    });
    expect(await screen.findByText("This plant model is not in the project.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the project's site" })).toHaveAttribute(
      "href",
      "/p/p1/site",
    );
  });

  it("no WebGL: a notice, the layers list and the register stay, the model is not shown", async () => {
    h.fail = new NoWebGlError("no");
    open(MODEL_SCENE);
    expect(await screen.findByRole("alert")).toHaveTextContent(/3D view is off/i);
    expect(layersPanel()).toHaveTextContent("Not shown");
    expect(await screen.findByRole("button", { name: /20-T-0001/ })).toBeInTheDocument();
  });

  it("a failed manifest says what happened and offers to try again", async () => {
    open({ status: 500 });
    expect(await screen.findByText("The site could not load.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("maps and drawings become drape layers with a switch each", async () => {
    open(TILE_SCENE);
    await viewStarted();
    const e = h.engines[0];
    // S1's layers; S2's extra layers (cloud, water, sky, photos, findings) join them.
    expect([...e.layers.keys()]).toEqual(expect.arrayContaining(["drawing:d1", "model", "ortho:o1"]));
    await userEvent.click(await within(layersPanel()).findByRole("switch", { name: "Site ortho" }));
    expect((e.layers.get("ortho:o1") as unknown as { shown: boolean }).shown).toBe(false);
    expect((e.layers.get("drawing:d1") as unknown as { shown: boolean }).shown).toBe(true);
    expect(within(layersPanel()).getByRole("switch", { name: "Site ortho" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("S2's layers join the engine and show in the Layers panel, photos off by default", async () => {
    open(MODEL_SCENE);
    await viewStarted();
    await waitFor(() => expect(h.engines[0].layers.has("sky")).toBe(true));
    expect([...h.engines[0].layers.keys()]).toEqual(
      expect.arrayContaining(["cloud:c1", "water", "sky", "photos", "findings"]),
    );
    const layers = layersPanel();
    expect(await within(layers).findByRole("switch", { name: "Sky" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(layers).getByRole("switch", { name: "Photos" })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("list", { name: "Layer status" })).toBeNull();
  });

  it("view tools drive the engine", async () => {
    open(MODEL_SCENE);
    await viewStarted();
    await userEvent.click(screen.getByRole("button", { name: "Plan view" }));
    expect(h.engines[0].setPreset).toHaveBeenCalledWith("plan");
    await userEvent.click(screen.getByRole("button", { name: "Pan" }));
    expect(h.engines[0].setNav).toHaveBeenCalledWith("pan");
    expect(screen.getByRole("button", { name: "Pan" })).toHaveAttribute("aria-pressed", "true");
  });
});
