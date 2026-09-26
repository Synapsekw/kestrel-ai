import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import { Icon, ICON_NAMES } from "./Icon";
import { Progress } from "./Progress";
import { Skeleton, SkeletonRows } from "./Skeleton";

const fillOf = (label: string) =>
  screen.getByRole("progressbar", { name: label }).querySelector<HTMLElement>('[data-part="fill"]')!;

describe("Progress", () => {
  it("draws the value with a transform, never a width", () => {
    render(<Progress value={0.3} label="Import" />);
    expect(screen.getByRole("progressbar", { name: "Import" })).toHaveAttribute("aria-valuenow", "30");
    expect(fillOf("Import").style.transform).toBe("translateX(-70%)");
    expect(fillOf("Import").style.width).toBe("");
  });

  it("shimmers only while its work runs", () => {
    const { rerender } = render(<Progress value={0.5} label="Train" />);
    expect(fillOf("Train").className).not.toContain("animate-shimmer");
    rerender(<Progress value={0.5} label="Train" running />);
    expect(fillOf("Train").className).toContain("animate-shimmer");
  });

  it("clamps out-of-range and NaN values", () => {
    render(
      <>
        <Progress value={1.7} label="Over" />
        <Progress value={Number.NaN} label="Broken" />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Over" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar", { name: "Broken" })).toHaveAttribute("aria-valuenow", "0");
    expect(fillOf("Broken").style.transform).toBe("translateX(-100%)");
  });

  it("has no value when indeterminate and slides instead", () => {
    render(<Progress label="Queued" />);
    expect(screen.getByRole("progressbar", { name: "Queued" })).not.toHaveAttribute("aria-valuenow");
    expect(fillOf("Queued").className).toContain("animate-indeterminate");
  });
});

describe("Skeleton", () => {
  it("keeps the animate-shimmer marker and SkeletonRows announces loading", () => {
    const { container } = render(
      <>
        <Skeleton className="h-4 w-10" />
        <SkeletonRows rows={2} columns={3} />
      </>,
    );
    expect(container.querySelectorAll(".animate-shimmer")).toHaveLength(7);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("teaches the screen and offers the first action", () => {
    render(<EmptyState icon="findings" title="No findings yet" action={<button>Add data</button>} />);
    expect(screen.getByText("No findings yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add data" })).toBeInTheDocument();
  });
});

describe("Icon", () => {
  it.each([
    "catalogue",
    "jobs",
    "findings",
    "measure",
    "report",
    "overview",
    "pin",
    "sparkle",
    "layers",
    "drawing",
    "elevation",
  ] as const)("draws %s", (name) => {
    const { container } = render(<Icon name={name} />);
    expect(container.querySelector(`svg[data-icon="${name}"] path`)?.getAttribute("d")).toMatch(/^M/);
  });

  it("lists every name for the gallery", () => {
    expect(ICON_NAMES).toContain("elevation");
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });
});
