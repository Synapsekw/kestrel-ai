import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import { isReducedMotion } from "@/ui";
import { isReducedEffects, onEffectsChange } from "./effects";
import { partsOf, type EngineParts } from "./s1Bridge";
import { SHORE_GRID, SHORE_MAX_M, shoreField, type Box2 } from "./shoreField";
import { StatusCell, type StatusLayer } from "./status";
import { SUN_COLOUR, sunDirection } from "./sun";

export const NO_MODEL = "Water shows once the plant model has loaded.";
export const NO_SEA = "This model has no sea.";
export const WATER_NORMALS_URL = `${import.meta.env.BASE_URL}textures/waternormals.jpg`;
/** Physical scene colours (a Gulf shallow sea and its foam), not UI colours. */
const WATER_COLOUR = 0x0b3d4a;
const FLAT_COLOUR = 0x1d5560;
const FOAM = new THREE.Color(0.86, 0.9, 0.92);
const LAND_ENVS = new Set(["land", "paved", "road", "laydown", "slope", "revetment"]);

const materialsOf = (n: THREE.Object3D): THREE.Material[] => {
  const m = (n as THREE.Mesh).material;
  return m ? (Array.isArray(m) ? m : [m]) : [];
};
/** Ruling 3 + R-S2-15: GLB extras, Cowork's `Sea` node name, or B3's "Sea" material (a GLB without extras). */
const isSea = (n: THREE.Object3D) =>
  n.userData?.env === "sea" || /^sea$/i.test(n.name) || materialsOf(n).some((m) => m.name === "Sea");
const isLand = (n: THREE.Object3D) => LAND_ENVS.has(String(n.userData?.env));

/** The world triangles ([x, z] × 3 each) of the meshes `match` marks, itself or through an ancestor up to `root`. */
export function collectTriangles(
  root: THREE.Object3D,
  match: (o: THREE.Object3D) => boolean,
): { tris: number[]; maxY: number; box: Box2 | null; meshes: THREE.Mesh[] } {
  root.updateMatrixWorld(true);
  const tris: number[] = [];
  const meshes: THREE.Mesh[] = [];
  let maxY = -Infinity;
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  const v = new THREE.Vector3();
  const marked = (o: THREE.Object3D): boolean => {
    for (let n: THREE.Object3D | null = o; n; n = n === root ? null : n.parent) if (match(n)) return true;
    return false;
  };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh || !marked(obj)) return;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) return;
    meshes.push(mesh);
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : pos.count;
    for (let k = 0; k + 2 < count; k += 3)
      for (let c = 0; c < 3; c++) {
        v.fromBufferAttribute(pos, index ? index.getX(k + c) : k + c).applyMatrix4(mesh.matrixWorld);
        tris.push(v.x, v.z);
        maxY = Math.max(maxY, v.y);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z);
        maxZ = Math.max(maxZ, v.z);
      }
  });
  return { tris, maxY, box: tris.length ? { minX, minZ, maxX, maxZ } : null, meshes };
}

/**
 * The triangles laid in a local XY plane as (x, −z, 0), counter-clockwise, degenerate ones dropped.
 * The mesh is rotated −90° about X, so local (u, v) lands on world (u, 0, −v) and faces +Y, which is
 * what three's Water assumes for its mirror plane.
 */
export function flatGeometry(tris: ArrayLike<number>): THREE.BufferGeometry {
  const out: number[] = [];
  for (let t = 0; t + 5 < tris.length; t += 6) {
    const ax = tris[t],
      ay = -tris[t + 1];
    let bx = tris[t + 2],
      by = -tris[t + 3],
      cx = tris[t + 4],
      cy = -tris[t + 5];
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(cross) < 1e-9) continue;
    if (cross < 0) [bx, by, cx, cy] = [cx, cy, bx, by];
    out.push(ax, ay, 0, bx, by, 0, cx, cy, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out), 3));
  g.computeVertexNormals();
  return g;
}

const FOAM_UNIFORMS = "uniform sampler2D shoreSampler;\nuniform vec4 shoreBox;\nuniform vec3 foamColor;";
const FOAM_GLSL = /* glsl */ `
  vec2 shoreUv = clamp( ( worldPosition.xz - shoreBox.xy ) / ( shoreBox.zw - shoreBox.xy ), 0.0, 1.0 );
  float shoreM = texture2D( shoreSampler, shoreUv ).r * ${SHORE_MAX_M.toFixed(1)};
  float foamNoise = getNoise( worldPosition.xz * 4.0 ).x * 0.5 + 0.5;
  float foam = 1.0 - smoothstep( 0.0, 2.5 + foamNoise * 2.0, shoreM );
  foam += smoothstep( 0.72, 1.0, sin( shoreM * 1.5 - time * 1.6 ) * 0.5 + 0.5 ) * ( 1.0 - smoothstep( 1.5, 8.0, shoreM ) ) * 0.55;
  outgoingLight = mix( outgoingLight, foamColor, clamp( foam, 0.0, 1.0 ) );
  gl_FragColor = vec4( outgoingLight, alpha );`;

/** Shoreline foam (Ruling 1) spliced into three 0.180's Water fragment shader. */
export function addFoam(material: THREE.ShaderMaterial, field: THREE.DataTexture, box: Box2): void {
  const src = material.fragmentShader;
  if (
    !src.includes("uniform vec3 waterColor;") ||
    !src.includes("gl_FragColor = vec4( outgoingLight, alpha );")
  )
    throw new Error("three's Water shader changed: re-check addFoam against three 0.180.0");
  material.uniforms.shoreSampler = { value: field };
  material.uniforms.shoreBox = { value: new THREE.Vector4(box.minX, box.minZ, box.maxX, box.maxZ) };
  material.uniforms.foamColor = { value: FOAM };
  material.fragmentShader = src
    .replace("uniform vec3 waterColor;", `uniform vec3 waterColor;\n${FOAM_UNIFORMS}`)
    .replace("gl_FragColor = vec4( outgoingLight, alpha );", FOAM_GLSL);
  material.needsUpdate = true;
}

export interface WaterLayer extends StatusLayer {
  /** The loaded plant GLB (S1's model layer), or null; rebuilds the water. */
  setModel(root: THREE.Object3D | null): void;
}

export function createWaterLayer(
  o: { normals?: () => THREE.Texture; reduced?: () => boolean; sun?: () => THREE.Vector3 } = {},
): WaterLayer {
  const status = new StatusCell({ kind: "unavailable", reason: NO_MODEL });
  const reduced = o.reduced ?? isReducedEffects;
  const sun = o.sun ?? (() => sunDirection());
  const loadNormals =
    o.normals ??
    (() => {
      const t = new THREE.TextureLoader().load(WATER_NORMALS_URL, () => parts?.requestRender());
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    });
  let parts: EngineParts | null = null;
  let root: THREE.Object3D | null = null;
  let mesh: THREE.Mesh | null = null;
  let seaMeshes: THREE.Mesh[] = [];
  let shoreTex: THREE.DataTexture | null = null;
  let normals: THREE.Texture | null = null;
  let visible = true;
  let stopEffects = () => {};

  const clear = () => {
    if (mesh) {
      parts?.scene.remove(mesh);
      mesh.geometry.dispose();
      const m = mesh.material as THREE.ShaderMaterial;
      // The mirror's render target owns its framebuffer; disposing it frees the texture too.
      const mirror = m.uniforms?.mirrorSampler?.value as
        (THREE.Texture & { renderTarget?: { dispose(): void } }) | undefined;
      if (mirror?.renderTarget) mirror.renderTarget.dispose();
      else mirror?.dispose();
      m.dispose();
      mesh = null;
    }
    shoreTex?.dispose();
    shoreTex = null;
    for (const s of seaMeshes) s.visible = true;
    seaMeshes = [];
  };

  const build = () => {
    clear();
    if (!parts) return;
    if (!root) {
      status.set({ kind: "unavailable", reason: NO_MODEL });
      return;
    }
    const sea = collectTriangles(root, isSea);
    if (!sea.box || sea.tris.length === 0) {
      status.set({ kind: "unavailable", reason: NO_SEA });
      return;
    }
    seaMeshes = sea.meshes;
    const geometry = flatGeometry(sea.tris);
    const flat = reduced();
    if (flat) {
      mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: FLAT_COLOUR, roughness: 0.35, metalness: 0 }),
      );
    } else {
      normals ??= loadNormals();
      const water = new Water(geometry, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: normals,
        sunDirection: sun(),
        sunColor: SUN_COLOUR,
        waterColor: WATER_COLOUR,
        distortionScale: 3.7,
        fog: false,
      });
      const land = collectTriangles(root, isLand);
      const field = shoreField(land.tris, sea.box, SHORE_GRID);
      if (field) {
        shoreTex = new THREE.DataTexture(
          field,
          SHORE_GRID,
          SHORE_GRID,
          THREE.RedFormat,
          THREE.UnsignedByteType,
        );
        shoreTex.minFilter = shoreTex.magFilter = THREE.LinearFilter;
        shoreTex.needsUpdate = true;
        addFoam(water.material as THREE.ShaderMaterial, shoreTex, sea.box);
      }
      mesh = water;
    }
    mesh.name = "site-water";
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = sea.maxY + 0.02;
    mesh.renderOrder = -5;
    mesh.visible = visible;
    for (const s of seaMeshes) s.visible = !visible;
    parts.scene.add(mesh);
    status.set(flat ? { kind: "ready", note: "Flat water (reduced effects)" } : { kind: "ready" });
    parts.requestRender();
  };

  return {
    id: "water",
    label: "Water",
    status,
    attach(e: SiteEngine) {
      // StrictMode re-attaches this object after a detach: drop any previous wiring, then rebuild.
      stopEffects();
      parts = partsOf(e);
      stopEffects = onEffectsChange(build);
      build();
    },
    detach() {
      stopEffects();
      stopEffects = () => {};
      clear();
      normals?.dispose();
      normals = null;
      parts = null;
    },
    setVisible(v) {
      visible = v;
      if (mesh) mesh.visible = v;
      for (const s of seaMeshes) s.visible = !v;
      parts?.requestRender();
    },
    setModel(r) {
      root = r;
      build();
    },
    update(dt) {
      // Ruling 2: time moves only on frames the engine draws anyway, never under reduced motion.
      if (!(mesh instanceof Water) || isReducedMotion()) return;
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.time.value = (u.time.value as number) + dt;
    },
  };
}
