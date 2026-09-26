import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InspectorLayout, InspectorPane, InspectorSection } from "./Inspector";

describe("InspectorLayout", () => {
  it("adds the 340 px column only while an inspector is open, stacking below 1100 px", () => {
    const { rerender, container } = render(
      <InspectorLayout inspector={null}>
        <p>Table</p>
      </InspectorLayout>,
    );
    const grid = container.firstElementChild!;
    expect(grid).toHaveAttribute("data-inspector", "closed");
    expect(grid.className).not.toContain("340px");
    rerender(
      <InspectorLayout inspector={<InspectorPane label="Finding">x</InspectorPane>}>
        <p>Table</p>
      </InspectorLayout>,
    );
    expect(grid).toHaveAttribute("data-inspector", "open");
    expect(grid.className).toContain("min-[1100px]:grid-cols-[minmax(0,1fr)_340px]");
    expect(screen.getByRole("complementary", { name: "Finding" })).toBeInTheDocument();
  });
});

describe("InspectorPane", () => {
  it("staggers its sections in order and keeps the footer outside the scroll area", () => {
    render(
      <InspectorPane label="Finding" header={<span>F-0217</span>} footer={<button>Close finding</button>}>
        <InspectorSection title="Type">Crack</InspectorSection>
        <InspectorSection title="Severity">Major</InspectorSection>
        {null}
        <InspectorSection title="Note">Hairline, 40 cm</InspectorSection>
      </InspectorPane>,
    );
    const pane = screen.getByRole("complementary", { name: "Finding" });
    expect(pane).toHaveAttribute("data-glass", "pane");
    const column = pane.querySelector('[data-part="sections"]')!;
    const wrappers = Array.from(column.children) as HTMLElement[];
    expect(wrappers.map((w) => w.style.getPropertyValue("--i"))).toEqual(["0", "1", "2"]);
    expect(wrappers[0].className).toContain("stagger");
    expect(screen.getByRole("region", { name: "Severity" })).toHaveTextContent("Major");
    expect(column.contains(screen.getByRole("button", { name: "Close finding" }))).toBe(false);
    expect(pane.lastElementChild).toHaveAttribute("data-part", "footer");
  });
});
