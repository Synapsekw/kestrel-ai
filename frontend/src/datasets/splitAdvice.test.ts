import { describe, expect, it } from "vitest";
import { splitAdvice, type SplitAdviceInput } from "./splitAdvice";

function dataset(overrides: Partial<SplitAdviceInput>): SplitAdviceInput {
  return {
    image_count: 30,
    train_count: 24,
    val_count: 6,
    split_method: "by_group",
    split_params: { val_fraction: 0.2, seed: 42 },
    ...overrides,
  };
}

describe("splitAdvice", () => {
  it("warns when a group-preserving split badly misses the requested fraction (walk-through S3)", () => {
    // 14 images in 4 groups, 0.2 requested, by_group -> 8 train / 6 val (43 %)
    const message = splitAdvice(
      dataset({
        image_count: 14,
        train_count: 8,
        val_count: 6,
        split_params: { val_fraction: 0.2, seed: 42 },
      }),
    );
    expect(message).toBe(
      "6 of 14 images (43 %) went to validation although 20 % was asked: whole flights stay " +
        "together, and this selection has few of them. With so few groups the random split gives " +
        "a fairer measure.",
    );
  });

  it("says nothing when the achieved fraction is close to what was asked", () => {
    expect(splitAdvice(dataset({ image_count: 30, train_count: 24, val_count: 6 }))).toBeNull();
  });

  it("warns when there is no validation split at all", () => {
    expect(splitAdvice(dataset({ image_count: 10, train_count: 10, val_count: 0 }))).toBe(
      "No validation images: training cannot measure the model. Use the random split or a larger fraction.",
    );
  });

  it("never warns about a random split, even far from the target", () => {
    expect(
      splitAdvice(
        dataset({
          image_count: 14,
          train_count: 8,
          val_count: 6,
          split_method: "random",
          split_params: { val_fraction: 0.2, seed: 42 },
        }),
      ),
    ).toBeNull();
  });
});
