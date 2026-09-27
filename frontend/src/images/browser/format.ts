/** "DJI_0212.JPG" → "DJI_0212": the grid and the map tooltip show stems (spec §6.1). */
export function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
