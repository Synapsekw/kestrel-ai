import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SeverityPicker, SeverityPill } from "./Severity";
import { DEFAULT_SEVERITY_SCALE, SeverityScaleContext } from "./severityScale";
import { StatusDot } from "./StatusDot";
import { TypeChip } from "./TypeChip";

describe("SeverityPill", () => {
  it("names the level and carries its colour in --c", () => {
    render(<SeverityPill level={3} />);
    expect(screen.getByText("Major").style.getPropertyValue("--c")).toBe("#ff9c3a");
  });

  it("says No severity for null and marks a level the scale no longer has", () => {
    render(
      <>
        <SeverityPill level={null} />
        <SeverityPill level={5} />
      </>,
    );
    expect(screen.getByText("No severity")).toBeInTheDocument();
    expect(screen.getByText("Level 5 (removed)")).toBeInTheDocument();
  });

  it("reads a custom scale from the provider", () => {
    render(
      <SeverityScaleContext.Provider
        value={[...DEFAULT_SEVERITY_SCALE, { level: 5, name: "Urgent", colour: "#ff00aa" }]}
      >
        <SeverityPill level={5} />
      </SeverityScaleContext.Provider>,
    );
    expect(screen.getByText("Urgent")).toBeInTheDocument();
  });
});

function Host({ allowNone = false }: { allowNone?: boolean }) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <>
      <SeverityPicker value={value} onChange={setValue} allowNone={allowNone} />
      <p data-testid="value">{value ?? "none"}</p>
    </>
  );
}

describe("SeverityPicker", () => {
  it("sets the level with 1–9 while focused, ignores digits beyond the scale, and keeps its keys", () => {
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<Host />);
    const minor = screen.getByRole("radio", { name: "1 Minor" });
    expect(minor).toHaveAttribute("tabindex", "0");
    minor.focus();
    fireEvent.keyDown(minor, { key: "3" });
    const major = screen.getByRole("radio", { name: "3 Major" });
    expect(screen.getByTestId("value")).toHaveTextContent("3");
    expect(major).toHaveAttribute("aria-checked", "true");
    expect(major).toHaveFocus();
    expect(onWindow).not.toHaveBeenCalled();
    fireEvent.keyDown(major, { key: "7" });
    expect(screen.getByTestId("value")).toHaveTextContent("3");
    expect(onWindow).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", onWindow);
  });

  it("chooses by click and arrow, and None clears when allowed", async () => {
    render(<Host allowNone />);
    await userEvent.click(screen.getByRole("radio", { name: "2 Moderate" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "2 Moderate" }), { key: "ArrowRight" });
    expect(screen.getByTestId("value")).toHaveTextContent("3");
    await userEvent.click(screen.getByRole("radio", { name: "None" }));
    expect(screen.getByTestId("value")).toHaveTextContent("none");
  });
});

describe("StatusDot", () => {
  it("pulses only when live and running", () => {
    render(
      <>
        <StatusDot status="running" live label="Job running" />
        <StatusDot status="open" live label="Open" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Job running" }).className).toContain("animate-pulse-dot");
    expect(screen.getByRole("img", { name: "Open" }).className).not.toContain("animate-pulse-dot");
  });

  it("is decorative without a label and green when idle", () => {
    const { container } = render(<StatusDot status="idle" />);
    const dot = container.firstElementChild!;
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot.className).toContain("bg-ok");
  });
});

describe("TypeChip", () => {
  it("shows the colour, the name and the kind", () => {
    render(<TypeChip name="Crack" colour="#ff5a4f" kind="defect" />);
    expect(screen.getByText("Crack")).toBeInTheDocument();
    expect(screen.getByText("Defect").className).toContain("text-danger");
  });

  it("marks an archived type for screen readers", () => {
    render(<TypeChip name="Excavator" colour="#8aa4ff" kind="object" archived />);
    expect(screen.getByText("Object").className).toContain("text-info");
    expect(screen.getByText("(archived)")).toHaveClass("sr-only");
  });
});
