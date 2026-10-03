import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewTools } from "./ViewTools";

describe("ViewTools", () => {
  it("shows Orbit as the active mode with its help, never as a dead button", () => {
    render(
      <ViewTools
        state={{ cut: false, levels: false, headOff: false }}
        disabled={false}
        onToggle={() => {}}
        onView={() => {}}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Orbit: drag to turn, right-drag to pan, scroll to zoom" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^orbit$/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Cut" })).toBeInTheDocument();
  });
});
