import { describe, expect, it } from "vitest";
import { eandBrand, partnerBrand } from "@/test/brandFixtures";
import { draftErrors, draftOf, hasErrors, nextBrandName, patchOf, previewOf } from "./brandDraft";

describe("brandDraft", () => {
  it("starts from the saved brand and patches nothing", () => {
    const d = draftOf(eandBrand);
    expect(d.name).toBe("e&");
    expect(patchOf(eandBrand, d)).toEqual({});
    expect(hasErrors(draftErrors(d))).toBe(false);
  });

  it("patches only what changed, trimmed, colours upper case and all six", () => {
    const d = draftOf(eandBrand);
    d.name = "  e&   drones ";
    d.colors = { ...d.colors, accent: "#00aa55" };
    d.website = " www.eand.com ";
    d.font_numerals = null;
    expect(patchOf(eandBrand, d)).toEqual({
      name: "e& drones",
      colors: { ...eandBrand.colors, accent: "#00AA55" },
      font_numerals: null,
    });
  });

  it("does not patch a colour that differs only in case", () => {
    const d = draftOf(eandBrand);
    d.colors = { ...d.colors, navy: "#141d2d" };
    expect(patchOf(eandBrand, d)).toEqual({});
  });

  it("flags a blank name and a malformed colour", () => {
    const d = draftOf(eandBrand);
    d.name = "   ";
    d.colors = { ...d.colors, pale: "#ffe5e" };
    const e = draftErrors(d);
    expect(e.name).toBe("A brand needs a name.");
    expect(e.colors).toEqual({ pale: "Use a colour like #1F4FD1." });
    expect(hasErrors(e)).toBe(true);
  });

  it("previews valid draft colours and keeps the saved one for an invalid entry", () => {
    const d = draftOf(eandBrand);
    d.colors = { ...d.colors, navy: "#000000", accent: "#12" };
    d.font_text = "Inter";
    const p = previewOf(eandBrand, d);
    expect(p.colors.navy).toBe("#000000");
    expect(p.colors.accent).toBe("#BC0000");
    expect(p.font_text).toBe("Inter");
    expect(p.logo_on_dark).toBe(eandBrand.logo_on_dark);
  });

  it("names a new brand after the ones that exist", () => {
    expect(nextBrandName(["e&", "White label"])).toBe("New brand");
    expect(nextBrandName(["new brand", "New brand 2"])).toBe("New brand 3");
    expect(nextBrandName([partnerBrand.name])).toBe("New brand");
  });
});
