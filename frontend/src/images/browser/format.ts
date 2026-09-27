/** "DJI_0212.JPG" → "DJI_0212": the grid and the map tooltip show stems (spec §6.1). */
export function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** "1 finding", "2 findings": counts in browser copy never read "1 findings". */
export function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/** "could not load the images" → "Could not load the images.": an error shown on its own. */
export function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const cap = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}
