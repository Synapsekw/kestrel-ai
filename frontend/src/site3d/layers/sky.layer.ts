import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import { partsOf, type EngineParts } from "./s1Bridge";
import { StatusCell, type StatusLayer } from "./status";
import { sunDirection } from "./sun";

/** The Sky box's half-size in metres; its shader pins depth to the far plane, so it never clips the site. */
export const SKY_SCALE = 450_000;

export interface SkyLayer extends StatusLayer {
  /** Unit vector towards the sun (scene frame); the water uses it for glitter. */
  sun(): THREE.Vector3;
}

/**
 * three's Sky, its sun matching the engine's directional light (see `addSiteLights`). Off, the sky
 * hides and the scene background is the `bg` token; the engine's lights stay so the model stays lit.
 * Sky parameters are physical scene values, not UI colours.
 */
export function createSkyLayer(o: { background?: () => THREE.Color } = {}): SkyLayer {
  const status = new StatusCell({ kind: "ready" });
  const dir = sunDirection();
  const background = o.background ?? (() => tokenColor(tokenRgb("bg")));
  let parts: EngineParts | null = null;
  let sky: Sky | null = null;
  let visible = true;

  function build(): Sky {
    const s = new Sky();
    s.name = "site-sky";
    s.scale.setScalar(SKY_SCALE);
    s.renderOrder = -10;
    const u = (s.material as THREE.ShaderMaterial).uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    (u.sunPosition.value as THREE.Vector3).copy(dir);
    return s;
  }

  const apply = () => {
    if (!parts || !sky) return;
    sky.visible = visible;
    parts.scene.background = visible ? null : background();
    parts.requestRender();
  };

  return {
    id: "sky",
    label: "Sky",
    status,
    sun: () => dir.clone(),
    attach(e: SiteEngine) {
      parts = partsOf(e);
      // Rebuilt on every attach: detach disposes the old one, and StrictMode re-attaches this object.
      sky = build();
      parts.scene.add(sky);
      apply();
    },
    detach() {
      if (parts) {
        if (sky) parts.scene.remove(sky);
        parts.scene.background = background();
      }
      if (sky) {
        sky.geometry.dispose();
        (sky.material as THREE.Material).dispose();
      }
      sky = null;
      parts = null;
    },
    setVisible(v) {
      visible = v;
      apply();
    },
  };
}
