import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AboutScreen, CloudsScreen, Later } from "./lazyScreens";

describe("lazy screens (foundation F0)", () => {
  it.each([
    ["Point clouds", <CloudsScreen key="c" />],
    ["About Kestrel AI", <AboutScreen key="a" />],
  ])("loads %s behind a placeholder", async (heading, element) => {
    render(<Later>{element}</Later>);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
  });
});
