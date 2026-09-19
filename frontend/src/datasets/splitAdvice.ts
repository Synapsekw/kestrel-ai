import type { Dataset } from "@contract/client";

/** The fields `splitAdvice` needs; a full `Dataset` satisfies this. */
export type SplitAdviceInput = Pick<
  Dataset,
  "image_count" | "train_count" | "val_count" | "split_method" | "split_params"
>;

const TOLERANCE = 0.1;

/**
 * Warn when a dataset's split does not do what the user asked (walk-through S3):
 * either there is nothing to validate on, or a group-preserving split (by_group / by_tile)
 * missed the requested validation fraction by a wide margin because the selection has too
 * few groups to hit it exactly.
 */
export function splitAdvice(dataset: SplitAdviceInput): string | null {
  const { image_count, val_count, split_method, split_params } = dataset;
  if (val_count === 0) {
    return "No validation images: training cannot measure the model. Use the random split or a larger fraction.";
  }
  if (split_method === "random" || image_count === 0) return null;
  const requested = split_params.val_fraction;
  const achieved = val_count / image_count;
  if (Math.abs(achieved - requested) <= TOLERANCE) return null;
  const pct = Math.round(achieved * 100);
  const requestedPct = Math.round(requested * 100);
  return (
    `${val_count} of ${image_count} images (${pct} %) went to validation although ${requestedPct} % ` +
    "was asked: whole flights stay together, and this selection has few of them. With so few " +
    "groups the random split gives a fairer measure."
  );
}
