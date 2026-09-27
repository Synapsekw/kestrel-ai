/** The "New training run" drawer, optionally with a dataset preselected (plan decision 11). */
export function trainingHref(opts: { datasetId?: string } = {}): string {
  const q = new URLSearchParams({ new: "1" });
  if (opts.datasetId) q.set("dataset", opts.datasetId);
  return `/models/training?${q}`;
}

/** The dataset builder, optionally preselected (the Images tab's "Use in dataset…", plan decision 9). */
export function datasetBuilderHref(opts: { projectIds?: string[]; typeIds?: string[] } = {}): string {
  const q = new URLSearchParams({ new: "1" });
  if (opts.projectIds?.length) q.set("project", opts.projectIds.join(","));
  if (opts.typeIds?.length) q.set("types", opts.typeIds.join(","));
  return `/models/datasets?${q}`;
}

export interface BuilderPreset {
  open: boolean;
  projectIds: string[];
  typeIds: string[];
}

export function readBuilderPreset(params: URLSearchParams): BuilderPreset {
  const list = (key: string) =>
    (params.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const projectIds = list("project");
  return { open: params.get("new") === "1" || projectIds.length > 0, projectIds, typeIds: list("types") };
}
