import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { describe, expect, it } from "vitest";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { createSkyLayer } from "./sky.layer";
import { addSiteLights, sunDirection } from "./sun";

const BG = new THREE.Color(0.05, 0.06, 0.1);

describe("sky layer", () => {
  it("adds only the sky, with no background behind it", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createSkyLayer({ background: () => BG });
    layer.attach(engine);
    expect(scene.getObjectByName("site-sky")).toBeInstanceOf(Sky);
    expect(scene.children.some((c) => (c as THREE.Light).isLight)).toBe(false);
    expect(scene.background).toBeNull();
    expect(layer.status.get()).toEqual({ kind: "ready" });
  });

  it("the sky's sun points the way the engine's sun light does", () => {
    const { engine, scene } = fakeSiteEngine();
    addSiteLights(scene);
    const layer = createSkyLayer({ background: () => BG });
    layer.attach(engine);
    const sky = scene.getObjectByName("site-sky") as Sky;
    const u = (sky.material as THREE.ShaderMaterial).uniforms.sunPosition.value as THREE.Vector3;
    expect(u.clone().normalize().distanceTo(layer.sun())).toBeLessThan(1e-9);
    const light = scene.getObjectByName("sun") as THREE.DirectionalLight;
    expect(light).toBeInstanceOf(THREE.DirectionalLight);
    expect(light.position.clone().normalize().distanceTo(sunDirection())).toBeLessThan(1e-9);
    expect(light.intensity).toBe(1.4);
  });

  it("off: the sky hides and the background is the token colour; the lights stay", () => {
    const { engine, scene, requestRender } = fakeSiteEngine();
    addSiteLights(scene);
    const layer = createSkyLayer({ background: () => BG });
    layer.attach(engine);
    requestRender.mockClear();
    layer.setVisible(false);
    expect(scene.getObjectByName("site-sky")!.visible).toBe(false);
    expect((scene.background as THREE.Color).equals(BG)).toBe(true);
    expect(scene.getObjectByName("sun")).toBeDefined();
    expect(requestRender).toHaveBeenCalled();
    layer.setVisible(true);
    expect(scene.background).toBeNull();
  });

  it("detach removes the sky and leaves the token background and the lights", () => {
    const { engine, scene } = fakeSiteEngine();
    addSiteLights(scene);
    const layer = createSkyLayer({ background: () => BG });
    layer.attach(engine);
    layer.detach();
    expect(scene.getObjectByName("site-sky")).toBeUndefined();
    expect(scene.getObjectByName("sun")).toBeDefined();
    expect((scene.background as THREE.Color).equals(BG)).toBe(true);
  });

  it("attach after detach shows again", () => {
    const { engine, scene } = fakeSiteEngine();
    const layer = createSkyLayer({ background: () => BG });
    layer.attach(engine);
    layer.detach();
    layer.attach(engine);
    const sky = scene.getObjectByName("site-sky") as Sky;
    expect(sky).toBeInstanceOf(Sky);
    expect(sky.visible).toBe(true);
    expect(scene.background).toBeNull();
  });
});
