import type { LibraryModel } from "@contract/client";

const ORIGIN_LABEL: Record<LibraryModel["origin"], string> = {
  trained: "Trained",
  imported: "Imported",
  starter: "Starter",
};

const TASK_LABEL: Record<LibraryModel["task"], string> = { detect: "Boxes", obb: "Rotated boxes" };

/** An en dash stands in for a metric the model does not have (an imported model has none). */
export function formatMetric(v: number | null | undefined): string {
  return typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "–";
}

/** `YYYY-MM-DD HH:mm` as written, for EXIF capture times (camera clock, no zone; same shape as the Data Manager). */
export function formatDate(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** `YYYY-MM-DD HH:mm` in the machine's local time, for timestamps the backend wrote (they are UTC). */
export function formatLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function originLabel(origin: LibraryModel["origin"]): string {
  return ORIGIN_LABEL[origin];
}

export function taskLabel(task: LibraryModel["task"]): string {
  return TASK_LABEL[task];
}

export interface ClassMapping {
  mapped: { from: string; to: string }[];
  /** Classes of the model that reach no project class; their detections are dropped. */
  ignored: number;
}

/** Which of a model's classes produce proposals in this project: same name, or an alias onto a project class. */
export function classMapping(
  modelClasses: string[],
  aliases: Record<string, string>,
  projectClasses: string[],
): ClassMapping {
  const known = new Set(projectClasses);
  const mapped = modelClasses
    .map((from) => ({ from, to: aliases[from] ?? from }))
    .filter((m) => known.has(m.to));
  return { mapped, ignored: modelClasses.length - mapped.length };
}
