import type { ClassDef, LibraryModel } from "@contract/client";

export const DETECT_TASKS: ReadonlySet<LibraryModel["task"]> = new Set(["detect", "obb", "segment"]);
export const DEFAULT_CONF = 0.25;

const TASK_LABEL: Record<string, string> = {
  detect: "Detection",
  obb: "Rotated boxes",
  segment: "Segmentation",
};
const norm = (s: string) => s.trim().toLowerCase();

/** F §7.4 in the client: exact name, then alias, then the class map; a null map entry ignores the class. */
export function reachableTypes(model: LibraryModel, types: readonly ClassDef[]): ClassDef[] {
  const byName = new Map(types.map((t) => [norm(t.name), t]));
  const byId = new Map(types.map((t) => [t.id, t]));
  const hit = new Map<string, ClassDef>();
  for (const name of model.class_names) {
    if (name in model.class_map) {
      const id = model.class_map[name];
      const t = id ? byId.get(id) : undefined;
      if (t) hit.set(t.id, t);
      continue;
    }
    const t = byName.get(norm(name)) ?? byName.get(norm(model.class_aliases[name] ?? ""));
    if (t) hit.set(t.id, t);
  }
  return types.filter((t) => hit.has(t.id));
}

export function menuSubtitle(model: LibraryModel, types: readonly ClassDef[]): string {
  const names = reachableTypes(model, types).map((t) => t.name);
  return `${TASK_LABEL[model.task] ?? model.task} · ${names.join(", ")}`;
}

function read(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function write(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* not remembered */
  }
}

export const readLastModel = (projectId: string) => read(`kestrel.images.detectModel.${projectId}`);
export const writeLastModel = (projectId: string, id: string) =>
  write(`kestrel.images.detectModel.${projectId}`, id);

export function readConf(modelId: string): number {
  const n = Number(read(`kestrel.images.detectConf.${modelId}`));
  return Number.isFinite(n) && n > 0 && n < 1 ? n : DEFAULT_CONF;
}
export const writeConf = (modelId: string, v: number) =>
  write(`kestrel.images.detectConf.${modelId}`, String(v));

export function stem(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
