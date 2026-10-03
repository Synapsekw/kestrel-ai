import { describe, expect, it } from "vitest";
import { PatchFormatError, labelAt, parseLabelGrid, parsePatchMesh } from "./patch";

function meshBuffer(positions: number[], uvs: number[], count = positions.length / 3): ArrayBuffer {
  const buf = new ArrayBuffer(4 + (positions.length + uvs.length) * 4);
  const dv = new DataView(buf);
  dv.setUint32(0, count, true);
  [...positions, ...uvs].forEach((v, i) => dv.setFloat32(4 + i * 4, v, true));
  return buf;
}

function labelBuffer(width: number, height: number, data: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(4 + data.length);
  const dv = new DataView(buf);
  dv.setUint16(0, width, true);
  dv.setUint16(2, height, true);
  new Uint8Array(buf, 4).set(data);
  return buf;
}

describe("patch binaries", () => {
  it("reads a little-endian header, then positions, then uvs", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const uvs = [0, 0, 1, 0, 0, 1];
    const mesh = parsePatchMesh(meshBuffer(positions, uvs));
    expect(mesh.vertexCount).toBe(3);
    expect(Array.from(mesh.positions)).toEqual(positions);
    expect(Array.from(mesh.uvs)).toEqual(uvs);
  });

  it("refuses a truncated mesh, an empty one and one that is not whole triangles", () => {
    expect(() => parsePatchMesh(new ArrayBuffer(2))).toThrow(PatchFormatError);
    expect(() => parsePatchMesh(meshBuffer([], [], 0))).toThrow(PatchFormatError);
    expect(() => parsePatchMesh(meshBuffer([0, 0, 0, 1, 0, 0], [0, 0, 1, 0]))).toThrow(PatchFormatError);
    const good = meshBuffer([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 1, 0, 0, 1]);
    expect(() => parsePatchMesh(good.slice(0, good.byteLength - 4))).toThrow(PatchFormatError);
  });

  it("reads the label grid and looks labels up with v = 1 at the top row", () => {
    const grid = parseLabelGrid(labelBuffer(2, 2, [0, 1, 2, 0]));
    expect(grid).toMatchObject({ width: 2, height: 2 });
    expect(labelAt(grid, 0.75, 0.75)).toBe(1); // top right
    expect(labelAt(grid, 0.25, 0.25)).toBe(2); // bottom left
    expect(labelAt(grid, 0.25, 0.75)).toBe(0); // top left, no defect
    expect(labelAt(grid, 1, 1)).toBe(1); // the far edge clamps into the grid
  });

  it("answers 0 outside the texture", () => {
    const grid = parseLabelGrid(labelBuffer(1, 1, [3]));
    expect(labelAt(grid, -0.01, 0.5)).toBe(0);
    expect(labelAt(grid, 0.5, 1.01)).toBe(0);
    expect(labelAt(grid, Number.NaN, 0.5)).toBe(0);
  });

  it("refuses a label grid whose size disagrees with its header", () => {
    expect(() => parseLabelGrid(labelBuffer(3, 3, [0, 0]))).toThrow(PatchFormatError);
  });
});
