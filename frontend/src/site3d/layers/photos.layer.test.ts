import * as THREE from "three";
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { FRAME, cloudRow, sceneWith } from "@/test/siteSceneFixtures";
import {
  NO_PHOTOS,
  PHOTOS_NO_CLOUD,
  PHOTOS_NO_FRAME,
  PHOTOS_OTHER_CRS,
  PHOTOS_TRUNCATED,
  PHOTO_GLYPH_CAP,
  capIndices,
  createPhotosLayer,
  photosCloudId,
  viewDirSite,
} from "./photos.layer";

const URL_ = "/api/v1/projects/p/pointclouds/c1/cameras";
function cameras(n: number, o: { noZ?: number; unposed?: number } = {}) {
  const fill = <T>(v: T) => Array.from({ length: n }, () => v);
  return {
    image_id: Array.from({ length: n }, (_, i) => `img-${i}`),
    source_idx: fill(0),
    x: Array.from({ length: n }, (_, i) => FRAME.origin_crs[0] + i),
    y: fill(FRAME.origin_crs[1]),
    z: Array.from({ length: n }, (_, i) => (i < (o.noZ ?? 0) ? null : 40)),
    yaw: Array.from({ length: n }, (_, i) => (i < (o.unposed ?? 0) ? null : 90)),
    pitch: Array.from({ length: n }, (_, i) => (i < (o.unposed ?? 0) ? null : -45)),
    roll: fill(0),
    hfov: fill(73.7),
    vfov: fill(53.1),
    fov_assumed: fill(false),
    width: fill(2048),
    height: fill(1536),
    sigma_m: fill(3),
    sources: [{ id: "s1", label: "Flight", count: n, height_offset_m: 0, posed_count: n }],
    truncated: false,
    z_p1: 0,
    z_p99: 50,
    without_gps: 0,
  };
}
function setup(body: object, scene = sceneWith({ clouds: [cloudRow()], photos: { count: 3, url: URL_ } })) {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/pointclouds\/c1\/cameras$/, body },
  ] as never);
  const f = fakeSiteEngine();
  const layer = createPhotosLayer({ api, projectId: "p", frame: FRAME, scene });
  layer.attach(f.engine);
  return { ...f, layer, requests };
}
const glyphs = (scene: THREE.Scene) => scene.getObjectByName("site-photos") as THREE.InstancedMesh;

describe("photos layer helpers", () => {
  it("reads the cloud id out of the scene's photos URL", () => {
    expect(photosCloudId(URL_)).toBe("c1");
    expect(photosCloudId(`${URL_}?token=t`)).toBe("c1");
    expect(photosCloudId("/api/v1/projects/p/images")).toBeNull();
    expect(photosCloudId("")).toBeNull();
    expect(photosCloudId(null)).toBeNull();
  });
  it("samples evenly down to the cap and keeps order", () => {
    const idx = Array.from({ length: 5000 }, (_, i) => i);
    const out = capIndices(idx, PHOTO_GLYPH_CAP);
    expect(out).toHaveLength(2000);
    expect(out[0]).toBe(0);
    expect(out.every((v, i) => i === 0 || v > out[i - 1])).toBe(true);
    expect(capIndices([1, 2, 3], 2000)).toEqual([1, 2, 3]);
  });
  it("turns yaw/pitch into a site view direction; no pose looks straight down", () => {
    const north = viewDirSite(0, 0);
    expect([north.x, north.y, north.z].map((v) => +v.toFixed(9))).toEqual([0, 1, 0]);
    expect(viewDirSite(90, -90).z).toBeCloseTo(-1, 9);
    expect(viewDirSite(null, null).toArray()).toEqual([0, 0, -1]);
  });
});

describe("photos layer", () => {
  it("draws one glyph per photo with an altitude and counts the ones without", async () => {
    const { layer, scene } = setup(cameras(3, { noZ: 1 }));
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(glyphs(scene).count).toBe(2);
    expect(layer.status.get()).toEqual({ kind: "ready", note: "1 without an altitude" });
  });

  it("caps at 2 000 glyphs and says so", async () => {
    const { layer, scene } = setup(cameras(2500));
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(glyphs(scene).count).toBe(2000);
    expect(layer.status.get()).toEqual({ kind: "ready", note: "Showing 2,000 of 2,500 photos" });
  });

  it("says when the server cut the camera list, so the count is not the whole project", async () => {
    const { layer } = setup({ ...cameras(2500), truncated: true });
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(layer.status.get()).toEqual({
      kind: "ready",
      note: `Showing 2,000 of 2,500 photos; ${PHOTOS_TRUNCATED}`,
    });
  });

  it("a cut list under the cap still says some photos were not listed", async () => {
    const { layer } = setup({ ...cameras(3), truncated: true });
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(layer.status.get()).toEqual({ kind: "ready", note: PHOTOS_TRUNCATED });
  });

  it("a photo with no gimbal angles points its glyph straight down", async () => {
    const { layer, scene } = setup(cameras(1, { unposed: 1 }));
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    const m = new THREE.Matrix4();
    glyphs(scene).getMatrixAt(0, m);
    const q = new THREE.Quaternion();
    m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const look = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
    expect(look.y).toBeCloseTo(-1, 6);
  });

  it("a scene without posed photos never asks for cameras", () => {
    const { layer, requests } = setup(cameras(1), sceneWith({ clouds: [cloudRow()] }));
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: NO_PHOTOS });
    expect(requests).toHaveLength(0);
  });

  it("photos of a cloud in another CRS are not placed", () => {
    const { layer, requests } = setup(
      cameras(1),
      sceneWith({ clouds: [cloudRow({ same_crs: false })], photos: { count: 1, url: URL_ } }),
    );
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: PHOTOS_OTHER_CRS });
    expect(requests).toHaveLength(0);
  });

  it("a click on a glyph names its photo; hidden glyphs are never hit", async () => {
    const { layer, camera } = setup(cameras(1));
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    // glyph 0 is at the plant origin, cloud z 40 → EL 160.45 → scene y 60.45
    camera.position.set(0, 160, 0);
    camera.lookAt(0, 60.45, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    expect(layer.hit(100, 100)).toEqual({ imageId: "img-0" });
    layer.setVisible(false);
    expect(layer.hit(100, 100)).toBeNull();
  });

  it("count without a placeable cloud says photos need a cloud", () => {
    const { layer, requests } = setup(cameras(1), sceneWith({ photos: { count: 4, url: "" } }));
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: PHOTOS_NO_CLOUD });
    expect(requests).toHaveLength(0);
  });

  it("without a site frame photos are unavailable", () => {
    const { api } = fakeClient([] as never);
    const layer = createPhotosLayer({
      api,
      projectId: "p",
      frame: null,
      scene: sceneWith({ photos: { count: 1, url: URL_ } }),
    });
    layer.attach(fakeSiteEngine().engine);
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: PHOTOS_NO_FRAME });
  });

  it("attach after detach loads again, and a read that lands after detach is dropped", async () => {
    const { layer, scene, engine } = setup(cameras(2));
    layer.detach();
    layer.attach(engine);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(scene.children.filter((c) => c.name === "site-photos")).toHaveLength(1);
    layer.detach();
    expect(glyphs(scene)).toBeUndefined();
  });
});
