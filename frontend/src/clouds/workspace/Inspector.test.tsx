import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Inspector } from "./Inspector";

describe("the inspector shell (spec §6)", () => {
  it("shows the two tabs with the features' counts and bodies, and placeholders without them", async () => {
    const onTab = vi.fn();
    const { rerender } = render(
      <Inspector tab="findings" onTab={onTab} findings={null} measurements={null} findingsMenu={[]} />,
    );
    expect(screen.getByRole("tab", { name: /Findings/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Pinned findings are listed here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Findings actions" })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: /Measurements/ }));
    expect(onTab).toHaveBeenCalledWith("measurements");
    const onSelect = vi.fn();
    rerender(
      <Inspector
        tab="findings"
        onTab={onTab}
        findings={{ body: <p>three pins</p>, count: 3 }}
        measurements={{ body: <p>list</p>, count: 4 }}
        findingsMenu={[{ id: "cap", label: "Capture missing views", onSelect }]}
      />,
    );
    expect(screen.getByRole("tab", { name: /Findings/ })).toHaveTextContent("3");
    expect(screen.getByText("three pins")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Findings actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Capture missing views" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
