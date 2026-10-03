import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneOrtho, SiteScene } from "@/api/siteScene";
import { toFrameT } from "@/api/siteScene";
import { fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { MODEL_SCENE, TILE_SCENE } from "@/test/siteSceneFixtures";
import type { SiteLayer } from "./layers/types";
import { SiteView, type SiteEngineInfo, type SiteViewProps } from "./SiteView";

/** S3 Task 1b: SiteView's plumbing for S3's panels (R-S3-4, R-S3-10). */
const h = vi.hoisted(() => ({
  engines: [] as Array<{ layers: Map<string, SiteLayer>; dispose: () => void }>,
  models: [] as Array<{
    id: string;
    url: string;
    opts: {
      url: string;
      onLoad?: (i: unknown, u: string) => void;
      onError?: (e: unknown, u: string) => void;
    };
    load: (url: string) => Promise<void>;
    setVisible: (v: boolean) => void;
  }>,
  drapes: [] as Array<{ id: string; onGone?: () => void; setVisible: (v: boolean) => void }>,
}));

vi.mock("@/site3d/engine/create", () => ({
  createSiteEngine: () => {
    const layers = new Map<string, SiteLayer>();
    const e = {
      layers,
      addLayer: vi.fn((l: SiteLayer) => layers.set(l.id, l)),
      removeLayer: vi.fn((id: string) => layers.delete(id)),
      select: vi.fn(),
      setPreset: vi.fn(),
      setNav: vi.fn(),
      onSelect: () => () => {},
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
      url: opts.url,
      attach: vi.fn(),
      detach: vi.fn(),
      setVisible: vi.fn(),
      load: vi.fn(async (u: string) => {
        l.url = u;
      }),
    };
    h.models.push(l);
    return l;
  },
}));

const drape = (id: string, onGone?: () => void) => {
  const l = { id, label: id, onGone, attach: vi.fn(), detach: vi.fn(), setVisible: vi.fn() };
  h.drapes.push(l);
  return l;
};
vi.mock("@/site3d/layers/ortho.layer", () => ({
  createOrthoLayer: (o: SceneOrtho, _url: unknown, onGone?: () => void) => drape(`ortho:${o.id}`, onGone),
}));
vi.mock("@/site3d/layers/drawing.layer", () => ({
  createDrawingLayer: (d: { id: string }, _url: unknown, onGone?: () => void) =>
    drape(`drawing:${d.id}`, onGone),
}));

const frame = toFrameT(MODEL_SCENE.frame)!;
const URL_V1 = "http://fake/glb/m1/1";

function view(over: Partial<SiteViewProps> = {}) {
  const { api } = fakeClient([]);
  const props: SiteViewProps = {
    scene: TILE_SCENE,
    frame,
    modelUrl: URL_V1,
    hidden: new Set(),
    onModel: vi.fn(),
    ...over,
  };
  const ui = (p: SiteViewProps) => (
    <TestApiProvider api={api}>
      <SiteView {...p} />
    </TestApiProvider>
  );
  const r = render(ui(props));
  return { ...r, props, update: (more: Partial<SiteViewProps>) => r.rerender(ui({ ...props, ...more })) };
}

const ids = (e: SiteEngineInfo | null) => e?.layers.map((l) => l.id).sort() ?? null;

describe("SiteView for S3's panels", () => {
  beforeEach(() => {
    h.engines.length = 0;
    h.models.length = 0;
    h.drapes.length = 0;
  });

  it("onEngine: the engine with its model and layers, again when layers change, null on dispose", async () => {
    const onEngine = vi.fn();
    const { update, unmount } = view({ onEngine });
    await waitFor(() => expect(h.engines).toHaveLength(1));
    const last = () => onEngine.mock.lastCall?.[0] as SiteEngineInfo | null;
    expect(last()?.engine).toBe(h.engines[0]);
    expect(last()?.model).toBe(h.models[0]);
    expect(ids(last())).toEqual(["drawing:d1", "model", "ortho:o1"]);
    update({ scene: { ...TILE_SCENE, orthos: [] } as SiteScene });
    await waitFor(() => expect(ids(last())).toEqual(["drawing:d1", "model"]));
    unmount();
    expect(onEngine).toHaveBeenLastCalledWith(null);
    expect(onEngine.mock.calls.filter(([e]) => e === null)).toHaveLength(1);
  });

  it("onLayerGone reaches the prop while the drape is attached, and is ignored after it is removed", async () => {
    const onLayerGone = vi.fn();
    const { update } = view({ onLayerGone });
    await waitFor(() => expect(h.drapes.map((d) => d.id)).toContain("ortho:o1"));
    const ortho = h.drapes.find((d) => d.id === "ortho:o1")!;
    act(() => ortho.onGone?.());
    expect(onLayerGone.mock.calls).toEqual([["ortho:o1"]]);
    update({ scene: { ...TILE_SCENE, orthos: [] } as SiteScene });
    await waitFor(() => expect(h.engines[0].layers.has("ortho:o1")).toBe(false));
    act(() => ortho.onGone?.());
    expect(onLayerGone).toHaveBeenCalledTimes(1);
  });

  it("a new GLB URL for the same model swaps it on the same layer; another model makes a new one", async () => {
    const onModel = vi.fn();
    const { update } = view({ onModel });
    await waitFor(() => expect(h.models).toHaveLength(1));
    update({ modelUrl: "http://fake/glb/m1/2" });
    await waitFor(() => expect(h.models[0].load).toHaveBeenCalledWith("http://fake/glb/m1/2"));
    expect(h.models).toHaveLength(1);
    expect(h.engines[0].layers.get("model")).toBe(h.models[0]);
    act(() => h.models[0].opts.onLoad?.({ items: 1, areas: [], types: [] }, "http://fake/glb/m1/2"));
    expect(onModel).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "http://fake/glb/m1/2", state: "ready" }),
    );

    const other = { ...TILE_SCENE, model: { ...TILE_SCENE.model!, id: "m2" } } as SiteScene;
    update({ scene: other, modelUrl: "http://fake/glb/m2/1" });
    await waitFor(() => expect(h.models).toHaveLength(2));
    expect(h.models[1].opts.url).toBe("http://fake/glb/m2/1");
    expect(h.models[1].load).not.toHaveBeenCalled();
  });

  it("visibility is per layer id and survives a drape re-made for new tiles", async () => {
    const { update } = view({ hidden: new Set(["ortho:o1"]) });
    await waitFor(() => expect(h.drapes).toHaveLength(2));
    const first = h.drapes.find((d) => d.id === "ortho:o1")!;
    expect(first.setVisible).toHaveBeenLastCalledWith(false);
    expect(h.drapes.find((d) => d.id === "drawing:d1")!.setVisible).toHaveBeenLastCalledWith(true);
    expect(h.models[0].setVisible).toHaveBeenLastCalledWith(true);
    const retiled = {
      ...TILE_SCENE,
      orthos: TILE_SCENE.orthos.map((o) => ({ ...o, tile_url_template: `${o.tile_url_template}&v=2` })),
    } as SiteScene;
    update({ scene: retiled, hidden: new Set(["ortho:o1"]) });
    await waitFor(() => expect(h.drapes.filter((d) => d.id === "ortho:o1")).toHaveLength(2));
    const again = h.drapes.filter((d) => d.id === "ortho:o1")[1];
    expect(again).not.toBe(first);
    expect(again.setVisible).toHaveBeenLastCalledWith(false);
  });
});
