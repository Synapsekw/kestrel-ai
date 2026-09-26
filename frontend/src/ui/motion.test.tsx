import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyMotion,
  cubicBezier,
  dur,
  easing,
  readMotionChoice,
  setMotionChoice,
  staggerTokens,
  useReducedMotion,
} from "./motion";

const css = readFileSync("src/index.css", "utf8");

/** The declarations of the first block after `selector`. */
function block(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `index.css has no ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => ({ matches, media, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

function Probe() {
  return <p>{useReducedMotion() ? "reduced" : "full"}</p>;
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
  delete document.documentElement.dataset.motion;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("motion tokens", () => {
  it("mirror index.css exactly", () => {
    for (const [name, ms] of Object.entries(dur)) expect(css).toContain(`--dur-${name}: ${ms}ms;`);
    const cssName = { out: "out", spring: "spring", inOut: "in-out" } as const;
    for (const [key, points] of Object.entries(easing)) {
      expect(css).toContain(
        `--ease-${cssName[key as keyof typeof cssName]}: cubic-bezier(${points.join(", ")});`,
      );
    }
    expect(css).toContain(`--stagger-step: ${staggerTokens.step}ms;`);
    expect(css).toContain(`--stagger-max: ${staggerTokens.max};`);
  });

  it.each(["@media (prefers-reduced-motion: reduce)", ':root[data-motion="reduced"]'])(
    "%s zeroes every duration but --dur-fast, and the stagger",
    (selector) => {
      const b = block(selector);
      for (const name of ["base", "slow", "emphasis", "count"]) expect(b).toContain(`--dur-${name}: 0ms;`);
      expect(b).toContain("--stagger-step: 0ms;");
      expect(b).not.toContain("--dur-fast");
    },
  );

  it("ease-out starts fast, ends at 1 and never goes back", () => {
    const f = cubicBezier(...easing.out);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    expect(f(0.5)).toBeGreaterThan(0.75);
    let last = 0;
    for (let x = 0.05; x <= 1; x += 0.05) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
  });
});

describe("useReducedMotion", () => {
  it("follows the OS setting", () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });

  it("follows the Settings override live", () => {
    render(<Probe />);
    expect(screen.getByText("full")).toBeInTheDocument();
    act(() => setMotionChoice("reduce"));
    expect(screen.getByText("reduced")).toBeInTheDocument();
    expect(document.documentElement.dataset.motion).toBe("reduced");
    act(() => setMotionChoice("system"));
    expect(screen.getByText("full")).toBeInTheDocument();
  });

  it("applies the saved choice at start-up", () => {
    localStorage.setItem("kestrel.motion", "reduce");
    applyMotion();
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("falls back to the system choice when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readMotionChoice()).toBe("system");
    expect(() => setMotionChoice("reduce")).not.toThrow();
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });
});
