import { describe, expect, it } from "vitest";
import type { Drawing } from "@/api/drawings";
import { pdfDrawing } from "@/mapws/drawings/testFixtures";
import { groupDrawingFiles } from "./drawingFiles";

const d = (
  id: string,
  name: string,
  source_path: string,
  page: number | null,
  status: Drawing["status"] = "ready",
): Drawing => ({
  ...pdfDrawing,
  id,
  name,
  source_path,
  page,
  status,
});

describe("groupDrawingFiles", () => {
  it("groups a PDF's pages by source file, pages in order, ready pages as refs", () => {
    const files = groupDrawingFiles([
      d("p2", "T5 · p2", "E:\\LNG\\T5.pdf", 2),
      d("ga", "GA drawing", "D:/plans/ga.dxf", null),
      d("p1", "T5 · p1", "e:/lng/t5.pdf", 1),
      d("p3", "T5 · p3", "E:\\LNG\\T5.pdf", 3, "failed"),
    ]);
    expect(files.map((f) => [f.label, f.meta, f.status])).toEqual([
      ["GA drawing", null, "ready"],
      ["T5.pdf", "3 pages · 1 failed", "ready"],
    ]);
    expect(files[1].drawings.map((x) => x.id)).toEqual(["p1", "p2", "p3"]);
    expect(files[1].refs).toEqual([
      { type: "drawing", id: "p1" },
      { type: "drawing", id: "p2" },
    ]);
  });

  it("a file with a page still importing is importing; one with every page failed is failed", () => {
    const files = groupDrawingFiles([
      d("a1", "A · p1", "C:\\a.pdf", 1),
      d("a2", "A · p2", "C:\\a.pdf", 2, "importing"),
      d("b1", "B", "C:\\b.png", null, "failed"),
    ]);
    expect(files.map((f) => f.status)).toEqual(["importing", "failed"]);
  });
});
