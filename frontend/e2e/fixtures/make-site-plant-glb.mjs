// Writes site-plant.glb: a two-item plant in the Site 3D frame (x north, y up, z east; metres; origin =
// plant origin at the datum) whose item nodes carry register-row extras in the shape A1 writes (plan S1,
// ruling R8). "rack.1" has a dot on purpose: GLTFLoader strips it from node names, extras keep it.
// Run from frontend/: node e2e/fixtures/make-site-plant-glb.mjs
import { writeFileSync } from "node:fs";

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
        pos.push(c[0] + p[0] * half[0], c[1] + p[1] * half[1], c[2] + p[2] * half[2]);
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
  ["tank shell", boxMesh([0, 15, 0], [40, 30, 40]), 0],
  ["rack frame", boxMesh([33, 4, 0], [6, 8, 30]), 1],
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

const row = (extra) => ({ area: "20", source_sheet: "P0058LNG-00-40-0-T0006", notes: "", ...extra });
const json = {
  asset: { version: "2.0", generator: "kestrel e2e fixture (plan S1)" },
  scene: 0,
  scenes: [{ name: "site-plant", nodes: [0] }],
  nodes: [
    {
      name: "site-plant",
      children: [1],
      extras: { frame: "x = plant N, y = EL - datum, z = plant E; metres" },
    },
    { name: "Area 20", children: [2, 4], extras: { group: "area", area: "20" } },
    {
      name: "20-t-0001",
      children: [3],
      extras: row({
        node: "20-t-0001",
        id: "20-t-0001",
        tag: "20-T-0001",
        name: "LNG tank",
        type: "tank_lng",
        height_source: "drawing",
        flags: "",
        confidence: "high",
      }),
    },
    { name: "20-t-0001/shell", mesh: 0 },
    {
      name: "rack.1",
      children: [5],
      extras: row({
        node: "rack.1",
        id: "rack.1",
        tag: null,
        name: "Pipe rack",
        type: "pipe_rack",
        height_source: "indicative",
        flags: "height_mismatch",
        confidence: "medium",
      }),
    },
    { name: "rack.1/frame", mesh: 1 },
  ],
  meshes,
  materials: [
    {
      name: "Concrete",
      pbrMetallicRoughness: {
        baseColorFactor: [0.75, 0.74, 0.7, 1],
        metallicFactor: 0,
        roughnessFactor: 0.9,
      },
    },
    {
      name: "Steel",
      pbrMetallicRoughness: {
        baseColorFactor: [0.55, 0.57, 0.6, 1],
        metallicFactor: 0.6,
        roughnessFactor: 0.5,
      },
    },
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
writeFileSync(new URL("./site-plant.glb", import.meta.url), out);
console.log(`site-plant.glb: ${out.length} bytes`);
