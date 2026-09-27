// frontend/src/clouds/viewer/pixels.ts
/** WebGL reads rows bottom-up; ImageData wants them top-down. */
export function flipRows(src: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const row = width * 4;
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < height; y++) out.set(src.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  return out;
}

/** The west (left) and east (right) halves of a top-down RGBA image, for the snapshot e2e. */
export function splitHalves(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { left: Uint8Array; right: Uint8Array } {
  const half = Math.floor(width / 2);
  const left = new Uint8Array(half * height * 4);
  const right = new Uint8Array((width - half) * height * 4);
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    left.set(rgba.subarray(rowStart, rowStart + half * 4), y * half * 4);
    right.set(rgba.subarray(rowStart + half * 4, rowStart + width * 4), y * (width - half) * 4);
  }
  return { left, right };
}
