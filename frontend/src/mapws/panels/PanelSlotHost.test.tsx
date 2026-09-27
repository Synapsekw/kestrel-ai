import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UTM33 } from "../test/fixtures";
import { PanelSlotHost } from "./PanelSlotHost";
import { registerPanel } from "./panelRegistry";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const panel = (id: string, slot: "bottom-center" | "top-center", order: number) =>
  cleanups.push(
    registerPanel({
      id,
      slot,
      order,
      Component: () => <div data-testid="panel">{id}</div>,
    }),
  );

describe("PanelSlotHost (W2's extension point)", () => {
  it("renders the panels registered for its slot, ordered by `order`", () => {
    panel("test.late", "bottom-center", 20);
    panel("test.early", "bottom-center", 10);
    panel("test.elsewhere", "top-center", 0);
    render(<PanelSlotHost slot="bottom-center" projectId="p" frame={UTM33} />);
    expect(screen.getAllByTestId("panel").map((e) => e.textContent)).toEqual(["test.early", "test.late"]);
  });

  it("renders nothing for a slot with no panel", () => {
    const { container } = render(<PanelSlotHost slot="bottom-right" projectId="p" frame={UTM33} />);
    expect(container).toBeEmptyDOMElement();
  });
});
