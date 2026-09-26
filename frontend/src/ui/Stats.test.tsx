import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPARK_MAX, Sparkline, sparkPaths } from "./Sparkline";
import { StatTile } from "./StatTile";
import { useCountUp } from "./useCountUp";

function Counter({ value }: { value: number }) {
  return <output>{Math.round(useCountUp(value))}</output>;
}

function reduceMotion() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => ({
      matches: true,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("useCountUp", () => {
  it("counts up on mount, holds on a re-render, and counts on from the shown value", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const { rerender } = render(<Counter value={100} />);
    const shown = () => Number(screen.getByRole("status").textContent);
    expect(shown()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(shown()).toBeGreaterThan(0);
    expect(shown()).toBeLessThan(100);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(shown()).toBe(100);
    rerender(<Counter value={100} />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(shown()).toBe(100);
    rerender(<Counter value={150} />);
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(shown()).toBeGreaterThanOrEqual(100);
    expect(shown()).toBeLessThan(150);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(shown()).toBe(150);
  });

  it("shows the final value at once under reduced motion", () => {
    reduceMotion();
    render(<Counter value={1284} />);
    expect(screen.getByRole("status")).toHaveTextContent("1284");
  });
});

describe("sparkPaths", () => {
  it("scales the values into the box", () => {
    expect(sparkPaths([0, 10], 100, 20)?.line).toBe("M2 18 L98 2");
  });

  it("keeps at most 60 finite points and survives flat, single and broken data", () => {
    const many = Array.from({ length: 100 }, (_, i) => i);
    expect(sparkPaths(many, 90, 32)!.line.split(" L")).toHaveLength(SPARK_MAX);
    expect(sparkPaths([5, 5, 5], 90, 32)!.line).not.toContain("NaN");
    expect(sparkPaths([1, Number.NaN, Infinity, 3], 90, 32)!.line.split(" L")).toHaveLength(2);
    expect(sparkPaths([7], 90, 32)!.line).toBe("M2 16 L88 16");
    expect(sparkPaths([], 90, 32)).toBeNull();
  });
});

describe("Sparkline", () => {
  it("draws in with the clip animation, but not under reduced motion", () => {
    const first = render(<Sparkline values={[1, 3, 2]} label="Open findings, 30 days" />);
    expect(screen.getByRole("img", { name: "Open findings, 30 days" })).toBeInTheDocument();
    expect(first.container.querySelector('[data-part="clip"]')).toHaveClass("spark-draw");
    first.unmount();
    reduceMotion();
    const again = render(<Sparkline values={[1, 3, 2]} />);
    expect(again.container.querySelector('[data-part="clip"]')).not.toHaveClass("spark-draw");
  });

  it("renders nothing without data", () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("StatTile", () => {
  it("shows the label, the value, the unit and a delta coloured by what is good", () => {
    reduceMotion();
    render(
      <>
        <StatTile
          label="Open findings"
          value={47}
          delta={{ value: 5, good: "down", label: "vs 7 days ago" }}
          spark={[1, 2, 3]}
        />
        <StatTile label="Stockpile volume" value={1234.5} unit="m³" delta={{ value: 120, good: "up" }} />
      </>,
    );
    expect(screen.getByText("Open findings")).toBeInTheDocument();
    expect(screen.getAllByText("47")).toHaveLength(2);
    expect(screen.getByText("▲ 5").className).toContain("text-danger");
    expect(screen.getByText("▲ 120").className).toContain("text-ok");
    expect(screen.getByText("m³")).toBeInTheDocument();
    expect(screen.getAllByText("1,234.5")).toHaveLength(2);
  });

  it("shows a dash, not a count, when there is no value", () => {
    render(<StatTile label="Stockpile volume" value={null} unit="m³" />);
    expect(screen.getByLabelText("No data")).toHaveTextContent("—");
    expect(screen.queryByText("m³")).toBeNull();
  });
});
