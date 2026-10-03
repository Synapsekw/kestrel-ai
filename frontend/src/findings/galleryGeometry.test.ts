import { describe, expect, it } from "vitest";
import { GALLERY_CAPTION, GALLERY_GAP, galleryGeometry } from "./galleryGeometry";

describe("galleryGeometry", () => {
  it("fits as many 176 px tiles as the width holds, 4:3 thumbs plus a caption", () => {
    const g = galleryGeometry(960);
    expect(g.cols).toBe(5);
    expect(g.tileW).toBeCloseTo((960 - 4 * GALLERY_GAP) / 5);
    expect(g.thumbH).toBeCloseTo((g.tileW * 3) / 4);
    expect(g.rowH).toBeCloseTo(g.thumbH + GALLERY_CAPTION + GALLERY_GAP);
  });

  it("uses the fallback width before the first measure (jsdom, first render)", () => {
    expect(galleryGeometry(0)).toEqual(galleryGeometry(960));
  });

  it("never drops below one column", () => {
    const g = galleryGeometry(120);
    expect(g.cols).toBe(1);
    expect(g.tileW).toBe(120);
  });
});
