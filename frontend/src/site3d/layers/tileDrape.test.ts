import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { TILE_SCENE } from "@/test/siteSceneFixtures";
import type { SiteEngine } from "../engine/SiteEngine";
import type { SiteFrameT } from "../engine/siteTransform";
import { GoneError, TileCache, type TileFetch } from "../engine/tiles";
import { createDrawingLayer, DRAWING_MAX_Z, DRAWING_Y } from "./drawing.layer";
import { createOrthoLayer, ORTHO_Y } from "./ortho.layer";

const FRAME: SiteFrameT = {
  crs: { epsg: 32639, wkt: null },
  origin_crs: [245000, 3180000],
  plant_north_deg: 17.9991,
  datum: { label: "HPFS", el_m: 100 },
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const url = (rel: string) => `http://b${rel}&token=t`;
const okTile: TileFetch = async () => ({ width: 256, height: 256 });

function engine(fetchTile: TileFetch = okTile) {
  const e = {
    frame: FRAME,
    scene: new THREE.Scene(),
    tiles: new TileCache(fetchTile, () => {}),
    requestRender: vi.fn(),
    setContentBox: vi.fn(),
    viewportHeight: () => 800,
    drapeCount: () => 1,
  };
  return e as unknown as SiteEngine & typeof e;
}

const far = () => {
  const c = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
  c.position.set(0, 50_000, 0);
  return c;
};

async function settle(
  layer: ReturnType<typeof createOrthoLayer>,
  e: ReturnType<typeof engine>,
  cam: THREE.Camera,
) {
  e.tiles.beginFrame();
  layer.update(0, cam);
  e.tiles.endFrame();
  await flush();
  e.tiles.beginFrame();
  layer.update(0, cam);
  e.tiles.endFrame();
}

describe("tile drape layers", () => {
  it("the ortho drapes its tiles at the datum with the token-bearing template", async () => {
    const fetchTile = vi.fn<TileFetch>(async () => ({ width: 256, height: 256 }));
    const e = engine(fetchTile);
    const layer = createOrthoLayer(TILE_SCENE.orthos[0], url);
    expect(layer.id).toBe("ortho:o1");
    layer.attach(e);
    expect(e.scene.children).toContain(layer.group);
    expect(e.setContentBox).toHaveBeenCalledWith("ortho:o1", expect.any(THREE.Box3));
    await settle(layer, e, far());
    const meshes = layer.group.children as THREE.Mesh[];
    expect(meshes.length).toBeGreaterThan(0);
    const firstUrl = fetchTile.mock.calls[0][0];
    expect(firstUrl).toMatch(
      /^http:\/\/b\/api\/v1\/projects\/p1\/site-tiles\/map\/o1\/\d+\/-?\d+\/-?\d+\?v=o1&frame_key=epsg%3A32639&token=t$/,
    );
    const pos = meshes[0].geometry.getAttribute("position");
    for (let i = 0; i < 4; i++) expect(pos.getY(i)).toBe(ORTHO_Y);
    expect(meshes[0].renderOrder).toBeLessThan(100);
  });

  it("drawings sit just above the ortho, draw after it, and choose their own zooms", async () => {
    const e = engine();
    const layer = createDrawingLayer(TILE_SCENE.drawings[0], url);
    expect(layer.id).toBe("drawing:d1");
    layer.attach(e);
    await settle(layer, e, far());
    const m = layer.group.children[0] as THREE.Mesh;
    expect(m.geometry.getAttribute("position").getY(0)).toBeCloseTo(DRAWING_Y, 6);
    expect(m.renderOrder).toBeGreaterThanOrEqual(100);
    expect((m.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.85, 6);
    expect(DRAWING_MAX_Z).toBe(19);
  });

  it("opacity and visibility apply; a hidden layer asks for no tiles", async () => {
    const fetchTile = vi.fn<TileFetch>(async () => ({ width: 256, height: 256 }));
    const e = engine(fetchTile);
    const layer = createOrthoLayer(TILE_SCENE.orthos[0], url);
    layer.attach(e);
    await settle(layer, e, far());
    layer.setOpacity(0.4);
    for (const m of layer.group.children as THREE.Mesh[])
      expect((m.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.4, 6);
    layer.setVisible(false);
    expect(layer.group.visible).toBe(false);
    expect(layer.shown).toBe(false);
    const calls = fetchTile.mock.calls.length;
    const near = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
    near.position.set(0, 20, 0);
    layer.update(0, near);
    expect(fetchTile.mock.calls.length).toBe(calls);
  });

  it("a gone layer (404/410) clears its tiles and says so once", async () => {
    const onGone = vi.fn();
    const e = engine(async (u) => Promise.reject(new GoneError(u)));
    const layer = createOrthoLayer(TILE_SCENE.orthos[0], url, onGone);
    layer.attach(e);
    await settle(layer, e, far());
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(layer.shown).toBe(false);
    expect(layer.group.children).toHaveLength(0);
  });

  it("detach removes its meshes and its content box", async () => {
    const e = engine();
    const layer = createOrthoLayer(TILE_SCENE.orthos[0], url);
    layer.attach(e);
    await settle(layer, e, far());
    layer.detach();
    expect(e.scene.children).not.toContain(layer.group);
    expect(layer.group.children).toHaveLength(0);
    expect(e.setContentBox).toHaveBeenLastCalledWith("ortho:o1", null);
  });
});
