import type { DatasetFilter, DatasetTask, LibraryDatasetCreate } from "@/api/libraryDatasets";

export interface BuilderForm {
  name: string;
  projectIds: string[];
  /** The frozen class order is this order (F §12.1 `classes`). */
  typeIds: string[];
  from: string;
  to: string;
  reviewedOnly: boolean;
  task: DatasetTask;
  split: "by_group" | "by_tile" | "random";
  valFraction: string;
  seed: string;
}

export function emptyBuilderForm(projectIds: string[], typeIds: string[]): BuilderForm {
  return {
    name: "",
    projectIds,
    typeIds,
    from: "",
    to: "",
    reviewedOnly: true,
    task: "detect",
    split: "by_group",
    valFraction: "0.2",
    seed: "42",
  };
}

/** The preview's filter; null until at least one project and one type are chosen. */
export function toFilter(f: BuilderForm): DatasetFilter | null {
  if (f.projectIds.length === 0 || f.typeIds.length === 0) return null;
  return {
    project_ids: f.projectIds,
    type_ids: f.typeIds,
    captured_from: f.from || null,
    captured_to: f.to || null,
    reviewed_only: f.reviewedOnly,
  };
}

export function validateBuilder(f: BuilderForm): string | null {
  const name = f.name.trim();
  if (!name) return "Give the dataset a name.";
  if (name.length > 120) return "Keep the name to 120 characters or fewer.";
  if (f.projectIds.length === 0) return "Choose at least one project.";
  if (f.typeIds.length === 0) return "Choose at least one type.";
  if (f.from && f.to && f.from > f.to) return "The start date is after the end date.";
  const fraction = Number(f.valFraction);
  if (!(fraction >= 0.05 && fraction <= 0.5)) return "Validation fraction must be between 0.05 and 0.5.";
  if (!/^-?\d+$/.test(f.seed.trim())) return "Seed must be a whole number.";
  return null;
}

/** Only call after `validateBuilder` returned null. */
export function toCreateBody(f: BuilderForm): LibraryDatasetCreate {
  const filter = toFilter(f);
  if (!filter) throw new Error("toCreateBody needs a project and a type");
  return {
    name: f.name.trim(),
    task: f.task,
    filter,
    split_method: f.split,
    val_fraction: Number(f.valFraction),
    seed: Number(f.seed),
  };
}
