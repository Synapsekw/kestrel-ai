import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GlassPanel } from "./GlassPanel";

describe("GlassPanel", () => {
  it("pane is a translucent card without blur; float is the one glass surface", () => {
    render(
      <>
        <GlassPanel data-testid="pane">a</GlassPanel>
        <GlassPanel variant="float" data-testid="float">
          b
        </GlassPanel>
      </>,
    );
    const pane = screen.getByTestId("pane");
    expect(pane).toHaveAttribute("data-glass", "pane");
    expect(pane.className).toContain("bg-surface");
    expect(pane.className).toContain("rounded-panel");
    expect(pane.className).not.toContain("glass-float");
    const float = screen.getByTestId("float");
    expect(float).toHaveAttribute("data-glass", "float");
    expect(float.className).toContain("glass-float");
    expect(float.className).toContain("rounded-control");
  });

  it("interactive adds the hover lift, and radius and element are configurable", () => {
    render(
      <GlassPanel interactive radius="control" as="aside" aria-label="Inspector">
        x
      </GlassPanel>,
    );
    const aside = screen.getByRole("complementary", { name: "Inspector" });
    expect(aside.className).toContain("hover:-translate-y-0.5");
    expect(aside.className).toContain("rounded-control");
    expect(aside.className).not.toContain("rounded-panel");
  });
});
