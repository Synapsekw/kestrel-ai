import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { exampleClasses, CLASS_ID } from "@/test/fixtures";
import { ClassSidebar } from "./ClassSidebar";

describe("ClassSidebar", () => {
  it("lists classes with hotkeys and counts and marks the active one", () => {
    const onSelect = vi.fn();
    render(
      <ClassSidebar
        classes={exampleClasses}
        activeClassId={CLASS_ID(4)}
        counts={{ [CLASS_ID(1)]: 2 }}
        onSelect={onSelect}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(8);
    expect(buttons[3]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[0]).toHaveTextContent("excavator");
    expect(buttons[0]).toHaveTextContent("1");
    expect(buttons[0]).toHaveTextContent("2");
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith(CLASS_ID(2));
  });
});
