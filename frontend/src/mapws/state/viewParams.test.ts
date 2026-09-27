import { describe, expect, it } from "vitest";
import { formatSelection, parseSelection, parseViewParams, writeViewParams } from "./viewParams";

describe("view params (spec §5: ?l=&r=&mode=&sel=)", () => {
  it("parses dates, the mode and the selection, ignoring junk", () => {
    expect(
      parseViewParams(new URLSearchParams("l=2026-08-14&r=2026-09-14&mode=swipe&sel=finding:f-1")),
    ).toEqual({
      l: "2026-08-14",
      r: "2026-09-14",
      mode: "swipe",
      sel: { kind: "finding", id: "f-1" },
    });
    expect(parseViewParams(new URLSearchParams("l=yesterday&mode=sideways&sel=nokind"))).toEqual({
      sel: null,
    });
    expect(parseViewParams(new URLSearchParams(""))).toEqual({});
  });

  it("splits the selection at the first colon only", () => {
    expect(parseSelection("volume:a:b")).toEqual({ kind: "volume", id: "a:b" });
    expect(parseSelection(":x")).toBeNull();
    expect(parseSelection("Finding:x")).toBeNull();
    expect(formatSelection({ kind: "run", id: "r1" })).toBe("run:r1");
  });

  it("writes the view, omits Single, and keeps every other param", () => {
    const next = writeViewParams(new URLSearchParams("finding=f1&x=1&mode=blend"), {
      l: "2026-08-14",
      r: "2026-09-14",
      mode: "single",
      selection: { kind: "finding", id: "f1" },
    });
    expect(next.get("mode")).toBeNull();
    expect(next.get("finding")).toBe("f1");
    expect(next.get("x")).toBe("1");
    expect(next.get("sel")).toBe("finding:f1");
    expect(next.get("l")).toBe("2026-08-14");
    expect(
      writeViewParams(next, {
        l: null,
        r: null,
        mode: "side",
        selection: null,
      }).toString(),
    ).toBe("finding=f1&x=1&mode=side");
  });
});
