import { describe, it, expect } from "vitest";
import { exampleImage } from "@/test/fixtures";
import { proposalsABulkMarkRejects } from "./markEmptyCounts";

describe("proposalsABulkMarkRejects", () => {
  it("counts only the images the bulk mark will really mark", () => {
    const row = (over: Partial<typeof exampleImage>) => ({
      ...exampleImage,
      box_count: 0,
      marked_empty: false,
      ...over,
    });
    expect(
      proposalsABulkMarkRejects([
        row({ pending_count: 3 }),
        row({ pending_count: 5, box_count: 2 }), // skipped: it has accepted boxes
        row({ pending_count: 7, marked_empty: true }), // already marked: left alone
        row({ pending_count: 0 }),
      ]),
    ).toBe(3);
  });
});
