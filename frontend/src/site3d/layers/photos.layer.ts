import * as THREE from "three";
import type { ApiClient, CloudCameraSet } from "@contract/client";
import { getCloudCameras } from "@/api/cloudCameras";
import { messageOf } from "@/api/errors";
import { GLYPH_DEPTH_M } from "@/clouds/cameras/cameraMath";
import { cameraBasis } from "@/clouds/photoLink";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import type { SiteFrameT } from "@/site3d/engine/siteTransform";
import { partsOf, type EngineParts } from "./s1Bridge";
import { siteToSceneMatrix } from "./sceneMatrix";
import type { SiteScene } from "./sceneTypes";
import { screenNearest } from "./screenPick";
import { StatusCell, type StatusLayer } from "./status";

/** Spec §11 / index: ≤ 2 000 glyphs, instanced. */
export const PHOTO_GLYPH_CAP = 2000;
export const NO_PHOTOS = "No posed photos in this project.";
export const PHOTOS_NO_FRAME = "Photos need the site's plant grid.";
export const PHOTOS_NO_CLOUD = "Photos show once a point cloud is placed on the site.";
export const PHOTOS_OTHER_CRS = "The photos' point cloud is in a different coordinate system from the site.";
/** The server cut the camera list, so the counts below cover only the photos it sent. */
export const PHOTOS_TRUNCATED = "Some photos were not listed.";
const fmt = new Intl.NumberFormat("en-GB");

/** The cloud whose cameras the scene's `photos.url` names (`…/pointclouds/{id}/cameras`), else null (Ruling 7). */
export function photosCloudId(url: string | null | undefined): string | null {
  const m = /\/pointclouds\/([^/?#]+)\/cameras(?:[?#]|$)/.exec(url ?? "");
  return m ? decodeURIComponent(m[1]) : null;
}

/** At most `cap` of `idx`, evenly spread, in order. */
export function capIndices(idx: readonly number[], cap: number): number[] {
  if (idx.length <= cap) return [...idx];
  const step = idx.length / cap;
  return Array.from({ length: cap }, (_, k) => idx[Math.floor(k * step)]);
}

/** Site-frame view direction (x east, y north, z up) from yaw (clockwise from grid north) and pitch; nadir without a pose. */
export function viewDirSite(yawDeg: number | null, pitchDeg: number | null): THREE.Vector3 {
  if (yawDeg == null || pitchDeg == null) return new THREE.Vector3(0, 0, -1);
  const [x, y, z] = cameraBasis(yawDeg, pitchDeg, 0).f;
  return new THREE.Vector3(x, y, z);
}

export interface PhotosLayer extends StatusLayer {
  hit(clientX: number, clientY: number): { imageId: string } | null;
}

export function createPhotosLayer(o: {
  api: ApiClient;
  projectId: string;
  frame: SiteFrameT | null;
  scene: SiteScene;
}): PhotosLayer {
  const status = new StatusCell();
  const DOWN = new THREE.Vector3(0, -1, 0);
  let parts: EngineParts | null = null;
  let mesh: THREE.InstancedMesh | null = null;
  let positions = new Float32Array(0);
  let ids: string[] = [];
  let visible = true;
  /** Bumped by every attach and detach: a read whose number is no longer current is discarded (StrictMode re-attaches the same layer). */
  let loadSeq = 0;

  function clear(): void {
    if (!mesh) return;
    parts?.scene.remove(mesh);
    (mesh.material as THREE.Material).dispose();
    mesh.geometry.dispose();
    mesh.dispose();
    mesh = null;
  }

  function place(set: CloudCameraSet, m: THREE.Matrix4): void {
    if (!parts) return;
    clear();
    const withZ = set.image_id.map((_, i) => i).filter((i) => set.z[i] != null);
    const shown = capIndices(withZ, PHOTO_GLYPH_CAP);
    const linear = new THREE.Matrix3().setFromMatrix4(m);
    // apex at the camera, base GLYPH_DEPTH_M ahead along local −Y; rotated so −Y is the view direction
    const geometry = new THREE.ConeGeometry(GLYPH_DEPTH_M * 0.4, GLYPH_DEPTH_M, 4).translate(
      0,
      -GLYPH_DEPTH_M / 2,
      0,
    );
    const material = new THREE.MeshBasicMaterial({
      color: tokenColor(tokenRgb("info")),
      transparent: true,
      opacity: 0.85,
    });
    const glyphs = new THREE.InstancedMesh(geometry, material, Math.max(1, shown.length));
    glyphs.count = shown.length;
    glyphs.name = "site-photos";
    glyphs.frustumCulled = false;
    glyphs.visible = visible;
    positions = new Float32Array(shown.length * 3);
    ids = [];
    const p = new THREE.Vector3();
    const d = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const mat = new THREE.Matrix4();
    shown.forEach((i, k) => {
      p.set(set.x[i], set.y[i], set.z[i] as number).applyMatrix4(m);
      d.copy(viewDirSite(set.yaw[i], set.pitch[i])).applyMatrix3(linear).normalize();
      q.setFromUnitVectors(DOWN, d);
      glyphs.setMatrixAt(k, mat.compose(p, q, one));
      positions.set([p.x, p.y, p.z], k * 3);
      ids.push(set.image_id[i]);
    });
    glyphs.instanceMatrix.needsUpdate = true;
    parts.scene.add(glyphs);
    mesh = glyphs;
    const notes: string[] = [];
    if (shown.length < withZ.length)
      notes.push(`Showing ${fmt.format(shown.length)} of ${fmt.format(withZ.length)} photos`);
    const noZ = set.image_id.length - withZ.length;
    if (noZ > 0) notes.push(`${fmt.format(noZ)} without an altitude`);
    if (set.truncated) notes.push(PHOTOS_TRUNCATED);
    status.set(notes.length ? { kind: "ready", note: notes.join("; ") } : { kind: "ready" });
    parts.requestRender();
  }

  function load(seq: number): void {
    if (!o.frame) return status.set({ kind: "unavailable", reason: PHOTOS_NO_FRAME });
    if (o.scene.photos.count === 0) return status.set({ kind: "unavailable", reason: NO_PHOTOS });
    const cloudId = photosCloudId(o.scene.photos.url);
    if (!cloudId) return status.set({ kind: "unavailable", reason: PHOTOS_NO_CLOUD });
    const cloud = o.scene.clouds.find((c) => c.id === cloudId);
    if (!cloud || !cloud.same_crs) return status.set({ kind: "unavailable", reason: PHOTOS_OTHER_CRS });
    const m = siteToSceneMatrix(o.frame, cloud.z_offset_m);
    status.set({ kind: "loading" });
    getCloudCameras(o.api, o.projectId, cloudId).then(
      (set) => {
        if (seq === loadSeq) place(set, m);
      },
      (e: unknown) => {
        if (seq === loadSeq)
          status.set({ kind: "error", message: messageOf(e, "The photo positions could not be loaded.") });
      },
    );
  }

  return {
    id: "photos",
    label: "Photos",
    status,
    attach(e: SiteEngine) {
      parts = partsOf(e);
      load(++loadSeq);
    },
    detach() {
      loadSeq++;
      clear();
      parts = null;
    },
    setVisible(v) {
      visible = v;
      if (mesh) mesh.visible = v;
      parts?.requestRender();
    },
    hit(clientX, clientY) {
      if (!mesh || !visible || !parts) return null;
      const i = screenNearest(
        positions,
        parts.camera,
        parts.canvas.getBoundingClientRect(),
        clientX,
        clientY,
      );
      return i === null ? null : { imageId: ids[i] };
    },
  };
}
