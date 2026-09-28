import { describe, expect, it } from "vitest";
import { placementSavedText } from "./messages";

describe("placementSavedText", () => {
  it("names the RMSE only above the minimum pair count (at the minimum the fit is exact by construction)", () => {
    expect(placementSavedText("similarity", 3, 0.06)).toBe("Placement saved · RMSE 6.0 cm");
    expect(placementSavedText("similarity", 2, 0)).toBe("Placement saved");
    expect(placementSavedText("affine", 3, 0)).toBe("Placement saved");
    expect(placementSavedText("affine", 4, 0.012)).toBe("Placement saved · RMSE 1.2 cm");
    expect(placementSavedText("similarity", 3, null)).toBe("Placement saved");
  });
});
