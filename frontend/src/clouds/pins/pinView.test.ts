import { describe, expect, it } from "vitest";
import { DEFAULT_SEVERITY_SCALE } from "@/ui";
import { projectTypes, TYPE_SPALLING } from "@/test/findingFixtures";
import { NEUTRAL_PIN_COLOUR, pinLabel, toPinView } from "./pinView";
import type { CloudPin } from "./types";

const types = new Map(projectTypes.map((t) => [t.id, t]));
const spalling = types.get(TYPE_SPALLING)!.name;
const pin: CloudPin = {
  id: "f-1",
  number: 217,
  typeId: TYPE_SPALLING,
  severity: 4,
  status: "open",
  note: "",
  p: [243500, 3178000, 40],
  u: 0.05,
  normal: null,
};

describe("pin view", () => {
  it("uses the severity colour and 'Severity · Type'", () => {
    const v = toPinView(pin, DEFAULT_SEVERITY_SCALE, types);
    expect(v).toMatchObject({ id: "f-1", p: pin.p, u: 0.05, normal: null, draft: false, colour: "#ff5a4f" });
    expect(v.label).toBe(`Critical · ${spalling}`);
    expect(v.ariaLabel).toBe(`F-0217 · Critical · ${spalling}`);
  });

  it("is neutral and Ungraded without a severity, and names an unknown type", () => {
    const v = toPinView({ ...pin, severity: null, typeId: "gone" }, DEFAULT_SEVERITY_SCALE, types);
    expect(v.colour).toBe(NEUTRAL_PIN_COLOUR);
    expect(v.label).toBe("Ungraded · Unknown type");
  });

  it("names a level missing from the scale", () => {
    expect(pinLabel(9, "Crack", DEFAULT_SEVERITY_SCALE)).toBe("Level 9 · Crack");
  });
});
