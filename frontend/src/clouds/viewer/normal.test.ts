import { describe, expect, it } from "vitest";
import { NORMAL_MIN_HITS, pcaNormal, symmetricEigen3 } from "./normal";
import type { Vec3 } from "./types";

/** A grid of points on the plane through `o` spanned by `a` and `b`, ±1 m at 0.25 m. */
function planeGrid(o: Vec3, a: Vec3, b: Vec3, noise = 0, n: Vec3 = [0, 0, 0]): Vec3[] {
  const out: Vec3[] = [];
  let k = 0;
  for (let i = -4; i <= 4; i += 1)
    for (let j = -4; j <= 4; j += 1) {
      const e = noise * Math.sin(12.9898 * k++); // deterministic ±noise along n
      out.push([
        o[0] + 0.25 * (i * a[0] + j * b[0]) + e * n[0],
        o[1] + 0.25 * (i * a[1] + j * b[1]) + e * n[1],
        o[2] + 0.25 * (i * a[2] + j * b[2]) + e * n[2],
      ]);
    }
  return out;
}

const close = (v: Vec3 | null, w: Vec3, digits = 6) => {
  expect(v).not.toBeNull();
  v!.forEach((x, i) => expect(x).toBeCloseTo(w[i], digits));
};

describe("symmetricEigen3", () => {
  it("answers ascending eigenvalues whose vectors satisfy A·v = λ·v", () => {
    const m = [
      [4, 1, 0.5],
      [1, 3, 0.2],
      [0.5, 0.2, 1],
    ];
    const { values, vectors } = symmetricEigen3(m);
    expect(values[0]).toBeLessThanOrEqual(values[1]);
    expect(values[1]).toBeLessThanOrEqual(values[2]);
    values.forEach((l, i) => {
      const v = vectors[i];
      for (let r = 0; r < 3; r += 1)
        expect(m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]).toBeCloseTo(l * v[r], 9);
      expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    });
  });
});

describe("pcaNormal", () => {
  const pick: Vec3 = [0, 0, 5];
  it("a horizontal plane seen from above has the normal +Z", () => {
    close(pcaNormal(planeGrid(pick, [1, 0, 0], [0, 1, 0]), pick, 0.5, [0, 0, 50]), [0, 0, 1]);
  });

  it("a noisy tilted plane still gives its normal within a degree", () => {
    const s = Math.SQRT1_2;
    const n: Vec3 = [0, -s, s]; // the plane z = y through the pick
    const got = pcaNormal(planeGrid(pick, [1, 0, 0], [0, s, s], 0.01, n), pick, 0.5, [0, -20, 25]);
    expect(got).not.toBeNull();
    expect(got![0] * n[0] + got![1] * n[1] + got![2] * n[2]).toBeGreaterThan(Math.cos((1 * Math.PI) / 180));
  });

  it("faces the camera: the same plane seen from below has the normal −Z", () => {
    close(pcaNormal(planeGrid(pick, [1, 0, 0], [0, 1, 0]), pick, 0.5, [0, 0, -50]), [0, 0, -1]);
  });

  it("is null with fewer than 8 hits within 3u, whatever lies farther out", () => {
    const near = planeGrid(pick, [1, 0, 0], [0, 1, 0])
      .slice(0, NORMAL_MIN_HITS - 1)
      .map((p): Vec3 => [pick[0] + (p[0] - pick[0]) / 10, pick[1] + (p[1] - pick[1]) / 10, 5]);
    const far = planeGrid([0, 0, 5], [1, 0, 0], [0, 1, 0]).map((p): Vec3 => [p[0] + 10, p[1], p[2]]);
    expect(pcaNormal([...near, ...far], pick, 0.05, [0, 0, 50])).toBeNull();
  });

  it("is null for a blob with no clear surface (smallest/middle > 0.3)", () => {
    const blob: Vec3[] = [];
    const n = 60;
    for (let i = 0; i < n; i += 1) {
      const z = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - z * z);
      const a = i * Math.PI * (3 - Math.sqrt(5)); // Fibonacci sphere
      blob.push([pick[0] + r * Math.cos(a), pick[1] + r * Math.sin(a), pick[2] + z]);
    }
    expect(pcaNormal(blob, pick, 0.5, [0, 0, 50])).toBeNull();
  });

  it("is null for hits on one line", () => {
    const line = Array.from({ length: 12 }, (_, i): Vec3 => [pick[0] + 0.1 * (i - 6), pick[1], pick[2]]);
    expect(pcaNormal(line, pick, 0.5, [0, 0, 50])).toBeNull();
  });

  it("keeps full precision at UTM magnitudes", () => {
    const utm: Vec3 = [243550.123, 3178050.456, 188.8];
    close(pcaNormal(planeGrid(utm, [0, 0, 1], [1, 0, 0]), utm, 0.5, [243550, 3178000, 190]), [0, -1, 0], 9);
  });
});
