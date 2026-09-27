import { describe, expect, it } from "vitest";
import { frameSwitchLabel } from "./frameSwitchModel";

describe("frameSwitchLabel (spec M §6)", () => {
  it("counts surfaces on the local side and items on the CRS side", () => {
    expect(frameSwitchLabel("crs", { crs: 4, local: 2 })).toBe("Local metres · 2 surfaces");
    expect(frameSwitchLabel("crs", { crs: 4, local: 1 })).toBe("Local metres · 1 surface");
    expect(frameSwitchLabel("local", { crs: 4, local: 2 })).toBe("Site CRS · 4 items");
    expect(frameSwitchLabel("local", { crs: 1, local: 2 })).toBe("Site CRS · 1 item");
  });
});
