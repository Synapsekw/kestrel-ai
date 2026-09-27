import { beforeEach, describe, expect, it } from "vitest";
import { useToastStore } from "@/ui";
import { useGoneLayers } from "./goneLayers";

describe("gone layers (M §14)", () => {
  beforeEach(() => {
    useGoneLayers.setState({ gone: new Set() });
    useToastStore.getState().clear();
  });

  it("drops a layer and toasts once however many tiles fail", () => {
    for (let i = 0; i < 12; i++)
      useGoneLayers.getState().markGone("map:a", "Orthomosaic · 14 Sep 2026");
    expect(useGoneLayers.getState().gone.has("map:a")).toBe(true);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].text).toBe(
      "Orthomosaic · 14 Sep 2026 is no longer available, so it was removed from the map.",
    );
  });
});
