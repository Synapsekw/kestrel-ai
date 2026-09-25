import type { Page } from "@playwright/test";

/** A minimal Potree 2.0 octree built in memory (DEFAULT encoding, one leaf root node, position +
 * rgb), served with HTTP Range exactly as the backend does (spec §7). Nothing binary is committed. */
export interface FixturePoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

export type OctreeFiles = Record<"metadata.json" | "hierarchy.bin" | "octree.bin", Buffer>;

const RECORD = 18; // int32 x, y, z + uint16 r, g, b

export function buildOctree(points: FixturePoint[], scale = 0.001): OctreeFiles {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    [p.x, p.y, p.z].forEach((v, i) => {
      min[i] = Math.min(min[i], v);
      max[i] = Math.max(max[i], v);
    });
  }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
  const cubeMax = min.map((v) => v + size);
  const octree = Buffer.alloc(points.length * RECORD);
  points.forEach((p, i) => {
    const o = i * RECORD;
    octree.writeInt32LE(Math.round((p.x - min[0]) / scale), o);
    octree.writeInt32LE(Math.round((p.y - min[1]) / scale), o + 4);
    octree.writeInt32LE(Math.round((p.z - min[2]) / scale), o + 8);
    octree.writeUInt16LE(p.r * 257, o + 12);
    octree.writeUInt16LE(p.g * 257, o + 14);
    octree.writeUInt16LE(p.b * 257, o + 16);
  });
  const hierarchy = Buffer.alloc(22);
  hierarchy.writeUInt8(1, 0); // leaf
  hierarchy.writeUInt8(0, 1); // no children
  hierarchy.writeUInt32LE(points.length, 2);
  hierarchy.writeBigInt64LE(0n, 6);
  hierarchy.writeBigInt64LE(BigInt(octree.length), 14);
  const metadata = {
    version: "2.0",
    name: "fixture",
    description: "",
    points: points.length,
    projection: "",
    hierarchy: { firstChunkSize: 22, stepSize: 4, depth: 0 },
    offset: min,
    scale: [scale, scale, scale],
    spacing: size / 128,
    boundingBox: { min, max: cubeMax },
    encoding: "DEFAULT",
    attributes: [
      {
        name: "position",
        description: "",
        size: 12,
        numElements: 3,
        elementSize: 4,
        type: "int32",
        min,
        max,
      },
      {
        name: "rgb",
        description: "",
        size: 6,
        numElements: 3,
        elementSize: 2,
        type: "uint16",
        min: [0, 0, 0],
        max: [65535, 65535, 65535],
      },
    ],
  };
  return {
    "metadata.json": Buffer.from(JSON.stringify(metadata)),
    "hierarchy.bin": hierarchy,
    "octree.bin": octree,
  };
}

/** A flat, gently sloping grid: red in the west half, green in the east half. */
export function redGreenGrid(o: {
  origin: [number, number, number];
  size: number;
  step: number;
}): FixturePoint[] {
  const out: FixturePoint[] = [];
  for (let x = 0; x <= o.size; x += o.step) {
    for (let y = 0; y <= o.size; y += o.step) {
      const west = x < o.size / 2;
      out.push({
        x: o.origin[0] + x,
        y: o.origin[1] + y,
        z: o.origin[2] + 0.02 * x,
        r: west ? 220 : 20,
        g: west ? 20 : 200,
        b: 20,
      });
    }
  }
  return out;
}

/**
 * A hollow stack seen from above (the §17.10 chimney in miniature): a thin rim of sparse points on a
 * circle of radius 1.5 m at z = top (one every 30°, 0.78 m apart: a coarse level of detail), a dense flue floor (0.05 m grid,
 * r < 1.45 m) at z = floor, and a ground apron (0.1 m grid, 2.5 m < r < 3 m) at z = 0. Straight down
 * at a spot on the rim between two rim points, the floor is the drawn point nearest the spot.
 */
export function hollowStack(o: { centre: [number, number]; top: number; floor: number }): FixturePoint[] {
  const [cx, cy] = o.centre;
  const out: FixturePoint[] = [];
  for (let deg = 0; deg < 360; deg += 30) {
    const a = (deg * Math.PI) / 180;
    out.push({ x: cx + 1.5 * Math.cos(a), y: cy + 1.5 * Math.sin(a), z: o.top, r: 220, g: 20, b: 20 });
  }
  for (let i = -60; i <= 60; i += 1) {
    for (let j = -60; j <= 60; j += 1) {
      const r = Math.hypot(i * 0.05, j * 0.05);
      if (r < 1.45) out.push({ x: cx + i * 0.05, y: cy + j * 0.05, z: o.floor, r: 20, g: 20, b: 200 });
    }
  }
  for (let i = -30; i <= 30; i += 1) {
    for (let j = -30; j <= 30; j += 1) {
      const r = Math.hypot(i * 0.1, j * 0.1);
      if (r > 2.5 && r < 3) out.push({ x: cx + i * 0.1, y: cy + j * 0.1, z: 0, r: 20, g: 200, b: 20 });
    }
  }
  return out;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Content-Range, Accept-Ranges, Content-Length",
};

export async function routeOctree(page: Page, cloudId: string, files: OctreeFiles): Promise<string[]> {
  const served: string[] = [];
  await page.route(
    (u) => u.pathname.includes(`/pointclouds/${cloudId}/octree/`),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") {
        return route.fulfill({
          status: 204,
          headers: {
            ...CORS,
            "access-control-allow-headers": "authorization, content-type, range",
            "access-control-allow-methods": "GET",
          },
        });
      }
      const name = new URL(req.url()).pathname.split("/").pop() as keyof OctreeFiles;
      const body = files[name];
      const type = name === "metadata.json" ? "application/json" : "application/octet-stream";
      const range = req.headers()["range"];
      served.push(range ? `${name} ${range}` : name);
      if (!body) return route.fulfill({ status: 422, headers: CORS, body: "" });
      const m = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
      if (!m) {
        return route.fulfill({
          status: 200,
          headers: { ...CORS, "content-type": type, "accept-ranges": "bytes" },
          body,
        });
      }
      const a = Number(m[1]);
      const b = Math.min(Number(m[2]), body.length - 1);
      return route.fulfill({
        status: 206,
        headers: {
          ...CORS,
          "content-type": type,
          "accept-ranges": "bytes",
          "content-range": `bytes ${a}-${b}/${body.length}`,
        },
        body: body.subarray(a, b + 1),
      });
    },
  );
  return served;
}
