import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { EMPTY_SCENE, FRAME_ONLY_SCENE, MODEL_SCENE, TILE_SCENE } from "@/test/siteSceneFixtures";
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
    opts: { url: string; onLoad?: (i: unknown) => void; onError?: (e: unknown) => void };
    setVisible: (v: boolean) => void;
  }>,
  fail: null as Error | null,
}));

vi.mock("@/site3d/engine/create", () => ({
  createSiteEngine: () => {
    if (h.fail) throw h.fail;
    let cb: ((hit: PickHit | null) => void) | null = null;
    const layers = new Map<string, SiteLayer>();
    const e = {
      layers,
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
}));

vi.mock("@/site3d/layers/model.layer", () => ({
  createModelLayer: (opts: { url: string }) => {
    const l = {
      id: "model",
      label: "Plant model",
      opts,
      attach: vi.fn(),
      detach: vi.fn(),
      setVisible: vi.fn(),
    };
    h.models.push(l);
    return l;
  },
}));

import { SiteScreen } from "./SiteScreen";

function open(scene: SiteScene | { status: number }, route = "/p/p1/site") {
  const { api } = fakeClient([
    "status" in scene
      ? {
          method: "GET",
          path: /\/site-scene/,
          status: scene.status,
          body: { error: { code: "boom", message: "The server failed", details: {} } },
        }
      : { method: "GET", path: /\/site-scene/, body: scene },
  ]);
  return renderWithProviders(<SiteScreen />, { api, route, path: "/p/:projectId/site/:modelId?" });
}

const TANK: PickHit = {
  layerId: "model",
  itemId: "20-t-0001",
  point: [0, 30, 0],
  extras: {
    name: "LNG tank",
    tag: "20-T-0001",
    type: "tank_lng",
    area: "20",
    height_source: "drawing",
    flags: "height_mismatch",
  },
};

describe("SiteScreen", () => {
  beforeEach(() => {
    h.engines.length = 0;
    h.models.length = 0;
    h.fail = null;
  });

  it("no frame: says nothing is placed, points at a plant model, makes no canvas (Review Focus 1)", async () => {
    open(EMPTY_SCENE);
    expect(await screen.findByText("Nothing to place yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a plant model" })).toHaveAttribute("href", "/p/p1/models");
    expect(screen.queryByTestId("site-canvas")).toBeNull();
    expect(h.engines).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("no model: opens the frame with layers greyed and the build empty state (Review Focus 1)", async () => {
    open(FRAME_ONLY_SCENE);
    expect(await screen.findByText("No plant model yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a plant model" })).toBeInTheDocument();
    expect(screen.getByTestId("site-canvas")).toBeInTheDocument();
    expect(h.engines).toHaveLength(1);
    const layers = screen.getByTestId("site-layers");
    const modelRow = within(layers).getByText("Plant model").closest("li")!;
    expect(modelRow).toHaveAttribute("aria-disabled", "true");
    expect(modelRow).toHaveTextContent("None yet");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/loading the plant model/i)).toBeNull();
    expect(h.models).toHaveLength(0);
  });

  it("a model loads with the token-bearing URL, counts its items, and a pick shows the item", async () => {
    open(MODEL_SCENE, "/p/p1/site/m1");
    await screen.findByTestId("site-canvas");
    expect(h.models[0].opts.url).toBe(
      "http://fake/api/v1/projects/p1/asset-models/m1/versions/1/glb?token=t",
    );
    expect(screen.getByText(/loading the plant model/i)).toBeInTheDocument();
    act(() => h.models[0].opts.onLoad?.({ items: 2, areas: ["20"], types: ["pipe_rack", "tank_lng"] }));
    expect(await screen.findByText("2 items")).toBeInTheDocument();
    expect(screen.queryByText(/loading the plant model/i)).toBeNull();
    act(() => h.engines[0].select(TANK));
    const card = await screen.findByTestId("site-selection");
    expect(card).toHaveTextContent("LNG tank");
    expect(card).toHaveTextContent("20-T-0001");
    expect(card).toHaveTextContent("Height mismatch");
    await userEvent.click(within(card).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByTestId("site-selection")).toBeNull();
  });

  it("a model that fails to load says so and offers a reload (Review Focus 3)", async () => {
    open(MODEL_SCENE);
    await screen.findByTestId("site-canvas");
    act(() => h.models[0].opts.onError?.(new Error("409")));
    expect(await screen.findByText("The plant model could not load.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload view" }));
    expect(h.engines.length).toBe(2);
    expect(h.engines[0].dispose).toHaveBeenCalled();
  });

  it("no WebGL: a notice, the layers list stays, no loading pill", async () => {
    h.fail = new NoWebGlError("no");
    open(MODEL_SCENE);
    expect(await screen.findByRole("alert")).toHaveTextContent(/3D view is off/i);
    expect(screen.getByTestId("site-layers")).toBeInTheDocument();
    expect(screen.queryByText(/loading the plant model/i)).toBeNull();
  });

  it("a failed manifest says what happened and offers to try again", async () => {
    open({ status: 500 });
    expect(await screen.findByText("The site could not load.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("maps and drawings become drape layers; switching Maps off hides them", async () => {
    open(TILE_SCENE);
    await screen.findByTestId("site-canvas");
    const e = h.engines[0];
    expect([...e.layers.keys()].sort()).toEqual(["drawing:d1", "model", "ortho:o1"]);
    await userEvent.click(screen.getByRole("switch", { name: "Maps" }));
    expect((e.layers.get("ortho:o1") as unknown as { shown: boolean }).shown).toBe(false);
    expect((e.layers.get("drawing:d1") as unknown as { shown: boolean }).shown).toBe(true);
  });

  it("view tools drive the engine", async () => {
    open(MODEL_SCENE);
    await screen.findByTestId("site-canvas");
    await userEvent.click(screen.getByRole("button", { name: "Plan view" }));
    expect(h.engines[0].setPreset).toHaveBeenCalledWith("plan");
    await userEvent.click(screen.getByRole("button", { name: "Pan" }));
    expect(h.engines[0].setNav).toHaveBeenCalledWith("pan");
    expect(screen.getByRole("button", { name: "Pan" })).toHaveAttribute("aria-pressed", "true");
  });
});
