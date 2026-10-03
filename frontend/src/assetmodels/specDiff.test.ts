import { describe, expect, it } from "vitest";
import { diffSpecs } from "./specDiff";

const part = (id: string, height = 3000) =>
  ({
    id,
    name: id,
    group: "Shell",
    shape: "cylinder",
    params: { id: 4000, thickness: 8, height },
    source: { kind: "assumed" },
  }) as const;

describe("diffSpecs", () => {
  it("finds added, removed and changed parts with the changed fields", () => {
    const a = { parts: [part("s1"), part("s2")] };
    const b = { parts: [part("s1", 3500), part("s3")] };
    expect(diffSpecs(a as never, b as never)).toEqual({
      added: ["s3"],
      removed: ["s2"],
      changed: [{ id: "s1", fields: ["params.height"] }],
    });
  });

  it("is empty for equal specs", () => {
    const a = { parts: [part("s1")] };
    expect(diffSpecs(a as never, a as never)).toEqual({ added: [], removed: [], changed: [] });
  });
});
