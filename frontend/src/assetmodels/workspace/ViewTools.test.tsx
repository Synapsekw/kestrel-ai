import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewToolButtons } from "./ViewTools";

describe("ViewToolButtons", () => {
  it("shows Orbit as the active mode with its help, never as a dead button", () => {
    render(
      <ViewToolButtons
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
