import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { PageTransition } from "./PageTransition";
import { transitionTiming } from "./transition";

const style = (vars: Record<string, string>) => ({ getPropertyValue: (n: string) => vars[n] ?? "" });

describe("transitionTiming", () => {
  it("rises 6px and fades in over --dur-base with --ease-out", () => {
    const t = transitionTiming(
      style({ "--dur-base": "180ms", "--ease-out": "cubic-bezier(.2,.8,.2,1)" }),
      "page",
    );
    expect(t.duration).toBe(180);
    expect(t.easing).toBe("cubic-bezier(.2,.8,.2,1)");
    expect(t.keyframes).toEqual([
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
  });

  it("only cross-fades onto a full-bleed surface, with --ease-in-out", () => {
    const t = transitionTiming(
      style({ "--dur-base": "0.18s", "--ease-in-out": "cubic-bezier(.65,0,.35,1)" }),
      "fullbleed",
    );
    expect(t.duration).toBe(180);
    expect(t.easing).toBe("cubic-bezier(.65,0,.35,1)");
    expect(t.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it("is instant under reduced motion, where the token is 0ms", () => {
    expect(transitionTiming(style({ "--dur-base": "0ms" }), "page").duration).toBe(0);
  });

  it("falls back to the spec's values when the tokens are missing", () => {
    const t = transitionTiming(style({}), "page");
    expect(t.duration).toBe(180);
    expect(t.easing).toBe("cubic-bezier(.2,.8,.2,1)");
  });
});

describe("PageTransition", () => {
  const animate = vi.fn();
  beforeEach(() => {
    animate.mockReset();
    Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  function renderAt(path: string) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Link to="/p/a/images">images</Link>
        <Link to="/p/a/findings">findings</Link>
        <Link to="/p/a/findings/f1">one finding</Link>
        <Link to="/p/a/maps/m1">map</Link>
        <PageTransition>
          <p>page</p>
        </PageTransition>
      </MemoryRouter>,
    );
  }

  it("does not animate the first page", () => {
    renderAt("/p/a/overview");
    expect(animate).not.toHaveBeenCalled();
  });

  it("animates a tab change once, and not a change inside the tab", () => {
    renderAt("/p/a/overview");
    fireEvent.click(screen.getByText("findings"));
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0]).toEqual([
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
    fireEvent.click(screen.getByText("one finding"));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("cross-fades onto the full-bleed map", () => {
    renderAt("/p/a/images");
    fireEvent.click(screen.getByText("map"));
    expect(animate.mock.calls[0][0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it("keys the wrapper on the tab for the e2e animation check", () => {
    renderAt("/p/a/findings/f1");
    expect(screen.getByText("page").parentElement).toHaveAttribute("data-transition-key", "p/a/findings");
  });
});
