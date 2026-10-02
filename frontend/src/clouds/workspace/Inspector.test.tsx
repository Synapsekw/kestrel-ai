import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Inspector } from "./Inspector";

describe("the inspector (spec §3.2: selection only)", () => {
  it("renders nothing without a selection", () => {
    const { container } = render(<Inspector detail={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull();
  });

  it("shows the selected item's detail in an aside named Inspector, with no tabs", () => {
    render(<Inspector detail={<p>F-0217 spalling</p>} />);
    const aside = screen.getByRole("complementary", { name: "Inspector" });
    expect(aside).toHaveTextContent("F-0217 spalling");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
