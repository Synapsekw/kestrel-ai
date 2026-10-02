export const GROUP_ORDER = [
  "Shell",
  "Head",
  "Bottom",
  "Nozzle",
  "Manway",
  "Support",
  "Access",
  "Internal",
  "Lining",
  "Other",
] as const;

export function groupParts<T extends { group: string }>(parts: T[]): [string, T[]][] {
  const by = new Map<string, T[]>();
  for (const p of parts) by.set(p.group, [...(by.get(p.group) ?? []), p]);
  const known = GROUP_ORDER.filter((g) => by.has(g)).map((g) => [g, by.get(g)!] as [string, T[]]);
  const other = [...by.keys()].filter((g) => !(GROUP_ORDER as readonly string[]).includes(g)).sort();
  return [...known, ...other.map((g) => [g, by.get(g)!] as [string, T[]])];
}
