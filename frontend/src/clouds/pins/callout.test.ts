import { describe, expect, it } from "vitest";
import { compass8, locationLabel, placeCallout } from "./callout";

const canvas = { width: 1400, height: 800 };
const pin = (x: number, y: number) => ({ state: "visible" as const, x, y });

describe("placeCallout (spec §9.3)", () => {
  it("goes 30 px right of the pin, centred on it", () => {
    expect(placeCallout(pin(500, 400), 260, canvas)).toEqual({
      left: 530,
      top: 270,
      side: "right",
      arrowY: 130,
    });
  });

  it("flips left when it would pass the inspector (width - 360)", () => {
    // 750 + 30 + 290 = 1070 > 1040
    expect(placeCallout(pin(750, 400), 260, canvas)).toMatchObject({ left: 430, side: "left" });
    // 720 + 30 + 290 = 1040: still fits
    expect(placeCallout(pin(720, 400), 260, canvas)).toMatchObject({ left: 750, side: "right" });
  });

  it("clamps the top to [12, height - h - 70] and keeps the arrow on the card", () => {
    expect(placeCallout(pin(500, 20), 260, canvas)).toMatchObject({ top: 12, arrowY: 14 });
    expect(placeCallout(pin(500, 790), 260, canvas)).toMatchObject({ top: 470, arrowY: 246 });
    expect(placeCallout(pin(500, 150), 260, { width: 1400, height: 300 })).toMatchObject({ top: 12 });
  });

  it("clamps a flipped card on a narrow canvas to 12 px", () => {
    expect(placeCallout(pin(200, 200), 260, { width: 500, height: 800 })).toMatchObject({
      left: 12,
      side: "left",
    });
  });

  it("is hidden while the pin is hidden or missing", () => {
    expect(placeCallout({ state: "hidden", x: 500, y: 400 }, 260, canvas)).toBeNull();
    expect(placeCallout(null, 260, canvas)).toBeNull();
    expect(placeCallout({ state: "back", x: 500, y: 400 }, 260, canvas)).not.toBeNull();
  });
});

describe("the callout header's location", () => {
  it("names the 8-point compass of a bearing", () => {
    expect([0, 44, 46, 90, 135, 180, 225, 270, 315, 359].map(compass8)).toEqual([
      "N",
      "NE",
      "NE",
      "E",
      "SE",
      "S",
      "SW",
      "W",
      "NW",
      "N",
    ]);
  });

  it("reads Z and the face the normal points to", () => {
    expect(locationLabel(52.04, [0.7, 0.7, 0.1])).toBe("Z 52.0 m · NE face");
    expect(locationLabel(-3.46, [0, -1, 0])).toBe("Z -3.5 m · S face");
    expect(locationLabel(52.04, null)).toBe("Z 52.0 m");
    expect(locationLabel(52.04, [0.1, 0.1, 0.99])).toBe("Z 52.0 m"); // a roof has no face bearing
  });
});
