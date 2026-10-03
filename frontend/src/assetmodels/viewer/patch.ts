// The derived patch files of spec §5.7, as J3's write_patch writes them (little-endian):
//   <sighting>.bin  uint32 vertexCount, Float32 xyz * N, Float32 uv * N (non-indexed triangles)
//   <sighting>.lbl  uint16 width, uint16 height, uint8 label * width * height (row 0 is the top)

export class PatchFormatError extends Error {}

export interface PatchMesh {
  vertexCount: number;
  positions: Float32Array;
  uvs: Float32Array;
}

export interface LabelGrid {
  width: number;
  height: number;
  data: Uint8Array;
}

export function parsePatchMesh(buf: ArrayBuffer): PatchMesh {
  if (buf.byteLength < 4) throw new PatchFormatError("the patch mesh is shorter than its header");
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  if (n === 0 || n % 3 !== 0)
    throw new PatchFormatError(`the patch mesh holds ${n} vertices, not whole triangles`);
  if (buf.byteLength !== 4 + n * 5 * 4) {
    throw new PatchFormatError(`the patch mesh is ${buf.byteLength} bytes; ${n} vertices need ${4 + n * 20}`);
  }
  // Read through the DataView: the file is little-endian whatever the machine is.
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) positions[i] = dv.getFloat32(4 + i * 4, true);
  const uvs = new Float32Array(n * 2);
  const at = 4 + n * 12;
  for (let i = 0; i < n * 2; i++) uvs[i] = dv.getFloat32(at + i * 4, true);
  return { vertexCount: n, positions, uvs };
}

export function parseLabelGrid(buf: ArrayBuffer): LabelGrid {
  if (buf.byteLength < 4) throw new PatchFormatError("the label grid is shorter than its header");
  const dv = new DataView(buf);
  const width = dv.getUint16(0, true);
  const height = dv.getUint16(2, true);
  if (width === 0 || height === 0 || buf.byteLength !== 4 + width * height) {
    throw new PatchFormatError(`the label grid is ${buf.byteLength} bytes for ${width} x ${height}`);
  }
  return { width, height, data: new Uint8Array(buf.slice(4)) };
}

/** The label under a texture coordinate; 0 (no defect) outside [0, 1]. v = 1 is the top row. */
export function labelAt(grid: LabelGrid, u: number, v: number): number {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return 0;
  const x = Math.min(grid.width - 1, Math.floor(u * grid.width));
  const y = Math.min(grid.height - 1, Math.floor((1 - v) * grid.height));
  return grid.data[y * grid.width + x] ?? 0;
}
