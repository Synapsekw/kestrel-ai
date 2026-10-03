import { describe, expect, it } from "vitest";
import { eandBrand, partnerBrand } from "@/test/brandFixtures";
import { coverBrandOf } from "./coverBrand";

describe("coverBrandOf", () => {
  it("takes the gradient from the shared overlay rules and the text font", () => {
    expect(coverBrandOf(eandBrand, "src://logo")).toEqual({
      gradient: ["#141D2D", "#141D2D", "#9E0000"],
      fontFamily: "Nunito Sans",
      logoSrc: "src://logo",
    });
  });

  it("leaves the font to the theme when the brand has none", () => {
    expect(coverBrandOf(partnerBrand, null).fontFamily).toBeNull();
  });
});
