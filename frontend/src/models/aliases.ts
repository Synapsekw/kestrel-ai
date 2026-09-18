/** Spec section 8: COCO weights map `truck` to the project's `dump_truck`. */
export const DEFAULT_ALIASES: Record<string, string> = { truck: "dump_truck" };

const LINE = /^([^=:>]+?)\s*(?:=|:|->)\s*(.+)$/;

/** One `model_class=project_class` per line (`:` and `->` also accepted); blank and `#` lines are ignored. */
export function parseAliases(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

export function formatAliases(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([from, to]) => `${from}=${to}`)
    .join("\n");
}
