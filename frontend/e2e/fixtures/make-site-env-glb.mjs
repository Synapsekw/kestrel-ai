// Writes site-env.glb for the S2 e2e (plan S2-8, preflight P-10): a sea slab and a land block under an
// "environment" group (identity transform, A1-shaped extras {env, id, kind, el, confidence}; the sea's
// material is named "Sea"), and one tank item. Frame as in make-site-plant-glb.mjs: metres, x plant N,
// y up (EL - datum 100), z plant E. Run from frontend/: node e2e/fixtures/make-site-env-glb.mjs
import { writeFileSync } from "node:fs";

/** An axis-aligned box: 24 vertices with face normals, 36 indices. */
function boxMesh([cx, cy, cz], [sx, sy, sz]) {
  const pos = [];
  const nrm = [];
  const idx = [];
  const half = [sx / 2, sy / 2, sz / 2];
  const c = [cx, cy, cz];
  const quad = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (let a = 0; a < 3; a++) {
    for (const s of [1, -1]) {
      const u = (a + 1) % 3;
      const v = (a + 2) % 3;
      const order = s > 0 ? quad : [...quad].reverse();
      const base = pos.length / 3;
      for (const [qu, qv] of order) {
        const p = [0, 0, 0];
        p[a] = s;
        p[u] = qu;
        p[v] = qv;
        for (let k = 0; k < 3; k++) pos.push(c[k] + p[k] * half[k]);
        const n = [0, 0, 0];
        n[a] = s;
        nrm.push(...n);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
}

const parts = [];
const bufferViews = [];
const accessors = [];
let offset = 0;
function addView(typed, target) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (bytes.length % 4)) % 4;
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  parts.push(bytes, Buffer.alloc(pad));
  offset += bytes.length + pad;
  return bufferViews.length - 1;
}
function minmax(pos) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  return [min, max];
}

const meshes = [];
for (const [name, geo, material] of [
  // top at y = -6.4 (EL 93.6); z 50..450 runs under the land's edge (z <= 100), so the shore has foam
  ["sea", boxMesh([0, -6.5, 250], [400, 0.2, 400]), 0],
  ["land", boxMesh([0, -3, 0], [400, 6, 200]), 1],
  ["tank shell", boxMesh([0, 15, 0], [40, 30, 40]), 2],
]) {
  const pv = addView(geo.pos, 34962);
  const nv = addView(geo.nrm, 34962);
  const iv = addView(geo.idx, 34963);
  const [min, max] = minmax(geo.pos);
  accessors.push({ bufferView: pv, componentType: 5126, count: geo.pos.length / 3, type: "VEC3", min, max });
  accessors.push({ bufferView: nv, componentType: 5126, count: geo.nrm.length / 3, type: "VEC3" });
  accessors.push({ bufferView: iv, componentType: 5123, count: geo.idx.length, type: "SCALAR" });
  const a = accessors.length - 3;
  meshes.push({
    name,
    primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2, material }],
  });
}

const pbr = (rgb, metal, rough) => ({
  pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: metal, roughnessFactor: rough },
});
const json = {
  asset: { version: "2.0", generator: "kestrel e2e fixture (plan S2-8)" },
  scene: 0,
  scenes: [{ name: "site-env", nodes: [0] }],
  nodes: [
    {
      name: "site-env",
      children: [1, 4],
      extras: { frame: "x = plant N, y = EL - datum, z = plant E; metres" },
    },
    { name: "environment", children: [2, 3], extras: { group: "environment" } },
    {
      name: "sea-1",
      mesh: 0,
      extras: { env: "sea", id: "sea-1", kind: "sea", el: 93.6, confidence: "medium" },
    },
    {
      name: "land-1",
      mesh: 1,
      extras: { env: "land", id: "land-1", kind: "land", el: 100, confidence: "high" },
    },
    {
      name: "20-t-0001",
      mesh: 2,
      extras: {
        node: "20-t-0001",
        id: "20-t-0001",
        tag: "20-T-0001",
        name: "LNG tank",
        type: "tank_lng",
        area: "20",
        height_source: "drawing",
        flags: "",
        confidence: "high",
      },
    },
  ],
  meshes,
  materials: [
    { name: "Sea", ...pbr([0.1, 0.3, 0.35], 0, 0.3) },
    { name: "Ground", ...pbr([0.62, 0.58, 0.5], 0, 0.95) },
    { name: "Concrete", ...pbr([0.75, 0.74, 0.7], 0, 0.9) },
  ],
  accessors,
  bufferViews,
  buffers: [{ byteLength: offset }],
};

const bin = Buffer.concat(parts);
let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const chunk = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.writeUInt32LE(type, 4);
  return b;
};
const out = Buffer.concat([
  header,
  chunk(jsonBuf.length, 0x4e4f534a),
  jsonBuf,
  chunk(bin.length, 0x004e4942),
  bin,
]);
writeFileSync(new URL("./site-env.glb", import.meta.url), out);
console.log(`site-env.glb: ${out.length} bytes`);
