/** The "New training run" drawer, optionally with a dataset preselected (plan decision 11). */
export function trainingHref(opts: { datasetId?: string } = {}): string {
  const q = new URLSearchParams({ new: "1" });
  if (opts.datasetId) q.set("dataset", opts.datasetId);
  return `/models/training?${q}`;
}
