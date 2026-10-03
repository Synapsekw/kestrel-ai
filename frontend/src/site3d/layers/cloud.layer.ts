import * as THREE from "three";
import type { PointCloudMaterial, PointCloudOctree } from "potree-core";
import { disposePointsGeometries } from "@/clouds/viewer/dispose";
import { usesNewFormat } from "@/clouds/viewer/materialOptions";
import { makeRequestManager, metadataUrl } from "@/clouds/viewer/requestManager";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import type { SiteFrameT } from "@/site3d/engine/siteTransform";
import type { CloudHost } from "./cloudHost";
import { partsOf, type EngineParts } from "./s1Bridge";
import { siteToSceneMatrix } from "./sceneMatrix";
import type { SiteCloud } from "./sceneTypes";
import { StatusCell, type StatusLayer } from "./status";

export const CANT_PLACE = "Can't place this cloud: it is in a different coordinate system from the site.";
export const NO_FRAME = "Can't place this cloud: the site has no plant grid yet.";

export type CloudColour = "rgb" | "elevation" | "intensity";
/** potree-core's PointColorType: RGB 0, HEIGHT 3, INTENSITY 4 (clouds/viewer/materialOptions.ts). */
const COLOR_TYPE: Record<CloudColour, 0 | 3 | 4> = { rgb: 0, elevation: 3, intensity: 4 };
type M = PointCloudMaterial;

/** potree-core colours height by `world.z`; the site scene is Y-up (Ruling 5). */
export function yUpElevation(src: string): string {
  return src.replace(/world\.z - heightMin/g, "world.y - heightMin");
}

export interface CloudLayer extends StatusLayer {
  readonly cloudId: string;
  setColour(c: CloudColour): void;
  /** The loaded cloud's box in scene metres, for "fly to"; null until loaded. */
  box(): THREE.Box3 | null;
}

export function createCloudLayer(o: {
  cloud: SiteCloud;
  frame: SiteFrameT | null;
  baseUrl: string;
  token: string;
  host: CloudHost;
}): CloudLayer {
  const status = new StatusCell();
  const group = new THREE.Group();
  group.name = `cloud:${o.cloud.id}`;
  group.matrixAutoUpdate = false;
  let parts: EngineParts | null = null;
  let pco: PointCloudOctree | null = null;
  let octreeV2 = false;
  let colour: CloudColour = "rgb";
  /** Bumped by every attach and detach: a load whose number is no longer current is discarded (StrictMode re-attaches the same layer). */
  let loadSeq = 0;

  function keepYUp(p: PointCloudOctree): void {
    const m = p.material as unknown as {
      updateShaderSource(): void;
      vertexShader: string;
      needsUpdate: boolean;
    };
    const regenerate = m.updateShaderSource.bind(m);
    // An own property shadows the prototype method, so potree-core's internal calls land here too.
    m.updateShaderSource = () => {
      regenerate();
      m.vertexShader = yUpElevation(m.vertexShader);
      m.needsUpdate = true;
    };
    m.updateShaderSource();
  }

  function applyColour(): void {
    if (!pco) return;
    const m = pco.material;
    const newFormat = usesNewFormat(colour, octreeV2);
    if (m.newFormat !== newFormat) {
      m.newFormat = newFormat;
      m.updateShaderSource();
    }
    m.pointColorType = COLOR_TYPE[colour] as M["pointColorType"];
    if (colour === "elevation") {
      const b = pco.getBoundingBoxWorld();
      m.elevationRange = [b.min.y, b.max.y];
    }
    parts?.requestRender();
  }

  return {
    id: `cloud:${o.cloud.id}`,
    label: o.cloud.name,
    cloudId: o.cloud.id,
    status,
    attach(e: SiteEngine) {
      const seq = ++loadSeq;
      parts = partsOf(e);
      if (!o.cloud.same_crs) {
        status.set({ kind: "unavailable", reason: CANT_PLACE });
        return;
      }
      if (!o.frame) {
        status.set({ kind: "unavailable", reason: NO_FRAME });
        return;
      }
      group.matrix.copy(siteToSceneMatrix(o.frame, o.cloud.z_offset_m));
      parts.scene.add(group);
      // potree's getBoundingBoxWorld reads the parent's matrixWorld: make it current before any load lands
      group.updateMatrixWorld(true);
      status.set({ kind: "loading" });
      // a malformed URL lands in the error branch below, never as an exception from attach
      const loading = Promise.resolve().then(() =>
        o.host.load(
          metadataUrl(new URL(o.cloud.octree_url, o.baseUrl).toString()),
          makeRequestManager(o.token),
        ),
      );
      return loading.then(
        (loaded) => {
          if (seq !== loadSeq) {
            disposePointsGeometries(loaded);
            loaded.dispose();
            return;
          }
          octreeV2 = loaded.material.newFormat;
          keepYUp(loaded);
          // sRGB in and out, adaptive size: as the clouds workspace (materialOptions.ts)
          loaded.material.inputColorEncoding = 1 as M["inputColorEncoding"];
          loaded.material.outputColorEncoding = 1 as M["outputColorEncoding"];
          loaded.material.pointSizeType = 2 as M["pointSizeType"];
          group.add(loaded);
          pco = loaded;
          o.host.add(loaded);
          applyColour();
          status.set({ kind: "ready" });
        },
        (err: unknown) => {
          if (seq !== loadSeq) return;
          const why = err instanceof Error ? err.message : String(err);
          status.set({ kind: "error", message: `The cloud could not load: ${why}` });
        },
      );
    },
    detach() {
      loadSeq++;
      if (pco) {
        o.host.remove(pco);
        group.remove(pco);
        disposePointsGeometries(pco);
        pco.dispose();
        pco = null;
      }
      parts?.scene.remove(group);
      parts = null;
    },
    setVisible(v) {
      group.visible = v;
      parts?.requestRender();
    },
    update(_dt, camera) {
      if (!pco || !parts) return;
      if (o.host.update(camera, parts.renderer, parts.renderer.info.render.frame)) parts.requestRender();
    },
    setColour(c) {
      colour = c;
      applyColour();
    },
    box: () => (pco ? pco.getBoundingBoxWorld() : null),
  };
}
