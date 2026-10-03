import type { AssetPart, AssetSpec } from "@contract/client";

export interface SpecDiff {
  added: string[];
  removed: string[];
  changed: { id: string; fields: string[] }[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function changedFields(a: AssetPart, b: AssetPart): string[] {
  const out: string[] = [];
  for (const key of ["name", "group", "shape", "material", "confidence", "note", "source"] as const) {
    if (!same(a[key], b[key])) out.push(key);
  }
  for (const nested of ["params", "placement"] as const) {
    const x = (a[nested] ?? {}) as Record<string, unknown>;
    const y = (b[nested] ?? {}) as Record<string, unknown>;
    for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
      if (!same(x[k], y[k])) out.push(`${nested}.${k}`);
    }
  }
  return out;
}

export function diffSpecs(a: AssetSpec, b: AssetSpec): SpecDiff {
  const A = new Map((a.parts ?? []).map((p) => [p.id, p]));
  const B = new Map((b.parts ?? []).map((p) => [p.id, p]));
  const changed = [...A.keys()]
    .filter((id) => B.has(id))
    .map((id) => ({ id, fields: changedFields(A.get(id)!, B.get(id)!) }))
    .filter((c) => c.fields.length > 0);
  return {
    added: [...B.keys()].filter((id) => !A.has(id)),
    removed: [...A.keys()].filter((id) => !B.has(id)),
    changed,
  };
}
