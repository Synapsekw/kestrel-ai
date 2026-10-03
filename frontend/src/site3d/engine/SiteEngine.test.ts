import { afterEach, describe, expect, it, vi } from "vitest";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { createSiteEngine } from "./create";
import { SiteEngine } from "./SiteEngine";

describe("SiteEngine", () => {
  afterEach(() => vi.restoreAllMocks());

  it("no WebGL is a NoWebGlError, never a half-built engine", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const err = vi.spyOn(console, "error").mockImplementation(() => {}); // three logs the failed context
    const canvas = document.createElement("canvas");
    expect(() => new SiteEngine(canvas, null)).toThrow(NoWebGlError);
    expect(() => createSiteEngine(canvas, null)).toThrow(NoWebGlError);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/WebGL/));
  });
});
