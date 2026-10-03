import * as THREE from "three";
import type { ApiClient } from "@contract/client";
import { listCloudPins, pinCapNote, type PinPage } from "@/api/cloudFindings";
import { listMapFindingsInView, type MapFindingsInView } from "@/api/mapFindings";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import { siteToScene, type SiteFrameT } from "@/site3d/engine/siteTransform";
import { DEFAULT_SEVERITY_SCALE, severityOf, type SeverityLevel } from "@/ui";
import { partsOf, type EngineParts } from "./s1Bridge";
import { siteToSceneMatrix } from "./sceneMatrix";
import type { SiteScene } from "./sceneTypes";
import { screenNearest } from "./screenPick";
import { StatusCell, type StatusLayer } from "./status";

/** `listMapFindingsInView`'s own cap. */
export const MAP_PIN_CAP = 5000;
const PIN_PX = 14;
export const NO_FINDINGS = "No findings with a map or cloud spot.";
export const FINDINGS_NO_FRAME = "Findings need the site's plant grid.";
export const FINDINGS_LOAD_ERROR = "The findings could not be loaded.";
const fmt = new Intl.NumberFormat("en-GB");

/** A GeoJSON point's coordinates or a polygon's outer-ring centroid (vertex mean), in the site frame. */
export function geometryPoint(g: { type: string; coordinates: unknown }): [number, number] | null {
  if (g.type === "Point" && Array.isArray(g.coordinates)) {
    const [x, y] = g.coordinates as number[];
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
    const ring = ((g.coordinates as number[][][])[0] ?? []).filter((p) => p.length >= 2);
    const closed =
      ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    const pts = closed ? ring.slice(0, -1) : ring;
    if (pts.length === 0) return null;
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  }
  return null;
}

/** The orthos' and drawings' union, else 1.5 km around the plant origin. */
export function siteExtent(scene: SiteScene, frame: SiteFrameT): [number, number, number, number] {
  const boxes = [
    ...scene.orthos.map((o) => o.bounds_site),
    ...scene.drawings.map((d) => d.bounds_site),
  ].filter((b): b is number[] => Array.isArray(b) && b.length === 4);
  if (boxes.length === 0) {
    const [x, y] = frame.origin_crs;
    return [x - 1500, y - 1500, x + 1500, y + 1500];
  }
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/** A round pin with a dark rim, as RGBA bytes (no 2D canvas: jsdom and the worker-free path both work). */
export function circleSprite(size = 32): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const r = size / 2 - 1;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const d = Math.hypot(i + 0.5 - size / 2, j + 0.5 - size / 2);
      const k = (j * size + i) * 4;
      const rim = d > r - 3 && d <= r;
      data[k] = data[k + 1] = data[k + 2] = rim ? 24 : 255;
      data[k + 3] = d <= r ? 255 : 0;
    }
  const t = new THREE.DataTexture(data, size, size);
  t.needsUpdate = true;
  return t;
}

export interface FindingsLayer extends StatusLayer {
  hit(clientX: number, clientY: number): { findingId: string } | null;
}

interface Pin {
  id: string;
  severity: number | null;
  at: THREE.Vector3;
}

export function createFindingsLayer(o: {
  api: ApiClient;
  projectId: string;
  frame: SiteFrameT | null;
  scene: SiteScene;
  scale?: readonly SeverityLevel[];
}): FindingsLayer {
  const status = new StatusCell();
  const scale = o.scale ?? DEFAULT_SEVERITY_SCALE;
  let parts: EngineParts | null = null;
  let points: THREE.Points | null = null;
  let positions = new Float32Array(0);
  let ids: string[] = [];
  let visible = true;
  /** Bumped by every attach and detach: a read whose number is no longer current is discarded (StrictMode re-attaches the same layer). */
  let loadSeq = 0;

  function clear(): void {
    if (!points) return;
    parts?.scene.remove(points);
    points.geometry.dispose();
    const m = points.material as THREE.PointsMaterial;
    m.map?.dispose();
    m.dispose();
    points = null;
  }

  function draw(pins: Pin[]): void {
    if (!parts || pins.length === 0) return;
    clear();
    positions = new Float32Array(pins.length * 3);
    const colours = new Float32Array(pins.length * 3);
    const fallback = tokenColor(tokenRgb("accent"));
    pins.forEach((p, k) => {
      positions.set([p.at.x, p.at.y, p.at.z], k * 3);
      const level = severityOf(scale, p.severity);
      const c = level ? new THREE.Color(level.colour) : fallback;
      colours.set([c.r, c.g, c.b], k * 3);
    });
    ids = pins.map((p) => p.id);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    // depthTest off: map pins sit at the datum, which raised land would hide
    const m = new THREE.PointsMaterial({
      size: PIN_PX,
      sizeAttenuation: false,
      vertexColors: true,
      map: circleSprite(),
      alphaTest: 0.5,
      depthTest: false,
    });
    points = new THREE.Points(g, m);
    points.name = "site-findings";
    points.renderOrder = 5;
    points.frustumCulled = false;
    points.visible = visible;
    parts.scene.add(points);
    parts.requestRender();
  }

  async function load(seq: number): Promise<void> {
    const frame = o.frame;
    if (!frame) return status.set({ kind: "unavailable", reason: FINDINGS_NO_FRAME });
    if (o.scene.findings.count === 0) return status.set({ kind: "ready", note: NO_FINDINGS });
    status.set({ kind: "loading" });
    const stopped = () => seq !== loadSeq;
    // Map findings answer in the map workspace's frame, which matches the plant frame only where orthos are served (Ruling 8)
    const orthos = o.scene.orthos;
    const clouds = o.scene.clouds.filter((c) => c.same_crs);
    const mapRead =
      orthos.length > 0
        ? listMapFindingsInView(o.api, o.projectId, {
            bbox: siteExtent({ ...o.scene, drawings: [] }, frame).join(","),
            map_ids: orthos.map((x) => x.id),
          })
        : null;
    const [map, perCloud] = await Promise.all([
      mapRead ? Promise.allSettled([mapRead]).then((r) => r[0]) : null,
      Promise.allSettled(clouds.map((c) => listCloudPins(o.api, o.projectId, c.id, stopped))),
    ]);
    if (stopped()) return;
    const pins: Pin[] = [];
    const notes: string[] = [];
    let failed = 0;
    if (map) {
      if (map.status === "fulfilled") {
        const v: MapFindingsInView = map.value;
        for (const f of v.items.slice(0, MAP_PIN_CAP)) {
          const pt = geometryPoint(f.geometry_site);
          if (!pt) continue;
          const [x, y, z] = siteToScene(frame, pt[0], pt[1], frame.datum.el_m); // at the datum
          pins.push({ id: f.id, severity: f.severity, at: new THREE.Vector3(x, y, z) });
        }
        if (v.truncated) notes.push(`Showing the first ${fmt.format(MAP_PIN_CAP)} map findings`);
      } else failed += 1;
    }
    perCloud.forEach((r, k) => {
      if (r.status !== "fulfilled") {
        failed += 1;
        return;
      }
      const page: PinPage = r.value;
      const m = siteToSceneMatrix(frame, clouds[k].z_offset_m);
      for (const f of page.items) {
        const a = f.anchor;
        if (a.kind !== "cloud") continue;
        pins.push({ id: f.id, severity: f.severity, at: new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(m) });
      }
      const note = pinCapNote(page);
      if (note) notes.push(`${clouds[k].name}: ${note}`);
    });
    const reads = (map ? 1 : 0) + clouds.length;
    if (reads > 0 && failed === reads) return status.set({ kind: "error", message: FINDINGS_LOAD_ERROR });
    if (failed > 0) notes.push("Some findings could not be loaded");
    draw(pins);
    if (pins.length === 0) notes.unshift(NO_FINDINGS);
    status.set(notes.length ? { kind: "ready", note: notes.join("; ") } : { kind: "ready" });
  }

  return {
    id: "findings",
    label: "Findings",
    status,
    attach(e: SiteEngine) {
      parts = partsOf(e);
      void load(++loadSeq);
    },
    detach() {
      loadSeq++;
      clear();
      parts = null;
    },
    setVisible(v) {
      visible = v;
      if (points) points.visible = v;
      parts?.requestRender();
    },
    hit(clientX, clientY) {
      if (!points || !visible || !parts) return null;
      const i = screenNearest(
        positions,
        parts.camera,
        parts.canvas.getBoundingClientRect(),
        clientX,
        clientY,
      );
      return i === null ? null : { findingId: ids[i] };
    },
  };
}
