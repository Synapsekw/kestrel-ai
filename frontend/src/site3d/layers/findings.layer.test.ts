import * as THREE from "three";
import { waitFor } from "@testing-library/react";
import { createApiClient } from "@contract/client";
import { describe, expect, it } from "vitest";
import { fakeClient, fakeFetch } from "@/test/fixtures";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { FRAME, cloudRow, sceneWith } from "@/test/siteSceneFixtures";
import {
  FINDINGS_NO_FRAME,
  MAP_PIN_CAP,
  NO_FINDINGS,
  circleSprite,
  createFindingsLayer,
  geometryPoint,
  siteExtent,
} from "./findings.layer";

const [OX, OY] = FRAME.origin_crs;
const mapPin = (id: string, severity: number | null, x = OX, y = OY) => ({
  id,
  number: 1,
  type_id: "t",
  severity,
  status: "open",
  created_by: "human",
  map_id: "m1",
  geometry_site: { type: "Point", coordinates: [x, y] },
});
const cloudFinding = (id: string, dx = 10) => ({
  id,
  severity: 2,
  anchor: { kind: "cloud", cloud_id: "c1", x: OX + dx, y: OY, z: -20.45, uncertainty_m: null },
});
const ORTHO = {
  id: "o1",
  name: "Ortho",
  tile_url_template: "",
  bounds_site: [OX - 100, OY - 100, OX + 100, OY + 100],
  min_z: 7,
  max_z: 17,
};
const scene = sceneWith({ clouds: [cloudRow()], orthos: [ORTHO], findings: { count: 2, url: "" } });

const MAP = (items: unknown[], truncated = false) => ({
  method: "GET",
  path: /\/map-workspace\/findings$/,
  body: { items, truncated },
});
const CLOUD = (items: unknown[]) => ({
  method: "GET",
  path: /\/findings$/,
  body: { items, next_cursor: null },
});
const FAIL = (path: RegExp) => ({
  method: "GET",
  path,
  status: 500,
  body: { error: { code: "x", message: "boom", details: {} } },
});
const pins = (s: THREE.Scene) => s.getObjectByName("site-findings") as THREE.Points;
const look = (camera: THREE.PerspectiveCamera, x: number, z: number) => {
  camera.position.set(x, 50, z);
  camera.lookAt(x, 0, z);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
};

function setup(routes: unknown[], s = scene) {
  const { api, requests } = fakeClient(routes as never);
  const f = fakeSiteEngine();
  const layer = createFindingsLayer({ api, projectId: "p", frame: FRAME, scene: s });
  layer.attach(f.engine);
  return { ...f, layer, requests, api };
}

describe("findings layer helpers", () => {
  it("takes a point's coordinates and a polygon's ring centroid", () => {
    expect(geometryPoint({ type: "Point", coordinates: [1, 2] })).toEqual([1, 2]);
    expect(
      geometryPoint({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      }),
    ).toEqual([2, 1]);
    expect(geometryPoint({ type: "LineString", coordinates: [] })).toBeNull();
  });

  it("the site extent is the union of the orthos and drawings, else 1.5 km around the origin", () => {
    const s = sceneWith({
      orthos: [{ bounds_site: [0, 0, 10, 10] }] as never,
      drawings: [{ bounds_site: [-5, 2, 4, 20] }] as never,
    });
    expect(siteExtent(s, FRAME)).toEqual([-5, 0, 10, 20]);
    expect(siteExtent(sceneWith(), FRAME)).toEqual([OX - 1500, OY - 1500, OX + 1500, OY + 1500]);
  });

  it("the map cap is the API's 5 000", () => {
    expect(MAP_PIN_CAP).toBe(5000);
  });

  it("circleSprite is an opaque disc with a transparent corner and a dark rim", () => {
    const t = circleSprite(16);
    const d = t.image.data as Uint8Array;
    expect(d[3]).toBe(0); // corner pixel is transparent
    const centre = (8 * 16 + 8) * 4;
    expect([d[centre], d[centre + 3]]).toEqual([255, 255]);
    const rim = (8 * 16 + 0) * 4 + 4; // x = 1 on the middle row, inside the rim band
    expect(d[rim]).toBe(24);
  });
});

describe("findings layer", () => {
  it("a project without findings never reads them", () => {
    const { layer, requests } = setup([], sceneWith({ findings: { count: 0, url: "" } }));
    expect(layer.status.get()).toEqual({ kind: "ready", note: NO_FINDINGS });
    expect(requests).toHaveLength(0);
  });

  it("without a site frame findings are unavailable", () => {
    const { api, requests } = fakeClient([] as never);
    const layer = createFindingsLayer({ api, projectId: "p", frame: null, scene });
    layer.attach(fakeSiteEngine().engine);
    expect(layer.status.get()).toEqual({ kind: "unavailable", reason: FINDINGS_NO_FRAME });
    expect(requests).toHaveLength(0);
  });

  it("pins map findings at the datum and cloud findings at their 3D spot, coloured by severity", async () => {
    const { layer, scene: s3 } = setup([MAP([mapPin("f1", 4)]), CLOUD([cloudFinding("f2")])]);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    const p = pins(s3);
    const pos = p.geometry.getAttribute("position");
    expect(pos.count).toBe(2);
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)].map((v) => +v.toFixed(4))).toEqual([0, 0, 0]);
    const col = p.geometry.getAttribute("color");
    const critical = new THREE.Color("#ff5a4f");
    expect(col.getX(0)).toBeCloseTo(critical.r, 5);
    expect(pos.getY(1)).toBeCloseTo(0, 4); // cloud z -20.45 + 120.45 = EL 100 = the datum
  });

  it("pins ignore depth so a pin at the datum shows through raised land", async () => {
    const { layer, scene: s3 } = setup([MAP([mapPin("f1", 4)]), CLOUD([])]);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect((pins(s3).material as THREE.PointsMaterial).depthTest).toBe(false);
  });

  it("reads map findings only over the orthos, asking for their ids", async () => {
    const { layer, requests } = setup([MAP([mapPin("f1", 1)]), CLOUD([])]);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    const mapReq = requests.find((r) => r.url.includes("/map-workspace/findings"))!;
    expect(mapReq.url).toContain("map_ids=o1");
    expect(decodeURIComponent(mapReq.url)).toContain(`bbox=${OX - 100},${OY - 100},${OX + 100},${OY + 100}`);
  });

  it("without orthos the map read is skipped and cloud pins still load", async () => {
    const {
      layer,
      requests,
      scene: s3,
    } = setup(
      [MAP([mapPin("f1", 1)]), CLOUD([cloudFinding("f2")])],
      sceneWith({ clouds: [cloudRow()], findings: { count: 1, url: "" } }),
    );
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(requests.some((r) => r.url.includes("/map-workspace/findings"))).toBe(false);
    expect(pins(s3).geometry.getAttribute("position").count).toBe(1);
  });

  it("no orthos and no placeable cloud reads nothing and says there is nothing to show", async () => {
    const { layer, requests } = setup([], sceneWith({ findings: { count: 3, url: "" } }));
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(layer.status.get()).toEqual({ kind: "ready", note: NO_FINDINGS });
    expect(requests).toHaveLength(0);
  });

  it("says when the map findings were cut at 5 000", async () => {
    const { layer } = setup([MAP([mapPin("f1", 1)], true), CLOUD([])]);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(layer.status.get()).toEqual({ kind: "ready", note: "Showing the first 5,000 map findings" });
  });

  it("every read failing is an error status, never an exception", async () => {
    const { layer } = setup([FAIL(/\/map-workspace\/findings$/), FAIL(/\/findings$/)]);
    await waitFor(() => expect(layer.status.get().kind).toBe("error"));
    expect(layer.status.get()).toEqual({ kind: "error", message: "The findings could not be loaded." });
  });

  it("one read failing still draws the other and notes it", async () => {
    const { layer, scene: s3 } = setup([MAP([mapPin("f1", 1)]), FAIL(/\/findings$/)]);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(layer.status.get()).toEqual({ kind: "ready", note: "Some findings could not be loaded" });
    expect(pins(s3).geometry.getAttribute("position").count).toBe(1);
  });

  it("a click on a pin names its finding, the second pin included", async () => {
    const { layer, camera, scene } = setup([MAP([mapPin("f1", 3)]), CLOUD([cloudFinding("f2", 10)])]);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    look(camera, 0, 0);
    expect(layer.hit(100, 100)).toEqual({ findingId: "f1" });
    const pos = pins(scene).geometry.getAttribute("position");
    look(camera, pos.getX(1), pos.getZ(1));
    expect(layer.hit(100, 100)).toEqual({ findingId: "f2" });
    layer.setVisible(false);
    expect(layer.hit(100, 100)).toBeNull();
  });

  it("a read that resolves after detach is dropped; attach after detach loads again", async () => {
    const { fetch: inner } = fakeFetch([MAP([mapPin("f1", 1)]), CLOUD([])] as never);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let gated = true;
    const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
      if (gated) await gate;
      return inner(input, init);
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
    const f = fakeSiteEngine();
    const layer = createFindingsLayer({ api, projectId: "p", frame: FRAME, scene });
    layer.attach(f.engine);
    expect(layer.status.get().kind).toBe("loading");
    layer.detach();
    gated = false;
    release();
    await new Promise((r) => setTimeout(r, 50)); // the stale reads have resolved by now
    expect(pins(f.scene)).toBeUndefined();
    expect(layer.status.get().kind).toBe("loading");

    layer.attach(f.engine);
    await waitFor(() => expect(layer.status.get().kind).toBe("ready"));
    expect(f.scene.children.filter((c) => c.name === "site-findings")).toHaveLength(1);
    layer.detach();
    expect(pins(f.scene)).toBeUndefined();
  });
});
