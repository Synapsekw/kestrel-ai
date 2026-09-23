import { describe, expect, it } from "vitest";
import { screenName } from "./Header";

describe("screenName", () => {
  it("names the app-level screens", () => {
    expect(screenName("/")).toBe("Projects");
    expect(screenName("/settings")).toBe("App settings");
    expect(screenName("/library")).toBe("Library");
  });

  it("names project screens, including Past detections", () => {
    expect(screenName("/p/abc")).toBe("Home");
    expect(screenName("/p/abc/past")).toBe("Past detections");
    expect(screenName("/p/abc/past/maps/m1")).toBe("Past detections");
    expect(screenName("/p/abc/maps/m1")).toBe("Maps");
    expect(screenName("/p/abc/query")).toBe("Detect");
  });
});
