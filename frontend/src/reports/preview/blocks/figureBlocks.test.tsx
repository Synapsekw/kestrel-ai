import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { figure } from "../fixtures";
import { installFakeIntersectionObserver, type FakeIntersection } from "../fakeIntersectionObserver";
import { PreviewEnvContext, usePreviewEnv } from "../PreviewContext";
import { FigureBlock } from "./FigureBlock";
import { FigureRowBlock } from "./FigureRowBlock";

let io: FakeIntersection;
beforeEach(() => {
  io = installFakeIntersectionObserver();
});
afterEach(() => io.restore());

const resolve = vi.fn((ref: { key: string }) => `snap://${ref.key}`);
const env = ({ children }: { children: ReactNode }) => (
  <PreviewEnvContext.Provider
    value={{ resolveSnapshot: resolve, resolveAsset: () => null, scrollRoot: null, paper: "A4" }}
  >
    {children}
  </PreviewEnvContext.Provider>
);
const near = (key: string) => (el: Element) => el.getAttribute("data-snapshot") === key;

describe("figure blocks", () => {
  // Block body, not a concise arrow: `mockClear()` returns the mock itself, and a concise-body
  // arrow here would hand that back to Vitest's beforeEach as a post-test cleanup function,
  // which Vitest then invokes with zero arguments after every test.
  beforeEach(() => {
    resolve.mockClear();
  });

  it("requests nothing until the figure is near the viewport, then shows a skeleton until it loads", () => {
    render(<FigureBlock block={figure("s1", "Image crop")} />, { wrapper: env });
    expect(screen.queryByRole("img", { name: "Image crop" })).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    act(() => io.show(near("s1")));
    const img = screen.getByRole("img", { name: "Image crop" });
    expect(img).toHaveAttribute("src", "snap://s1");
    expect(screen.getByTestId("snapshot-skeleton")).toBeInTheDocument();
    fireEvent.load(img);
    expect(screen.queryByTestId("snapshot-skeleton")).toBeNull();
    expect(screen.getByText("Image crop")).toBeInTheDocument(); // the caption
  });

  it("keeps the image once seen (no unload when it scrolls away)", () => {
    render(<FigureBlock block={figure("s2", "Map")} />, { wrapper: env });
    act(() => io.show(near("s2")));
    act(() => io.show(near("s2"), false));
    expect(screen.getByRole("img", { name: "Map" })).toHaveAttribute("src", "snap://s2");
  });

  it("shows the reason and never requests when the snapshot is missing", () => {
    render(<FigureBlock block={figure("s3", "Image crop", 170, 105, "The source image was moved")} />, {
      wrapper: env,
    });
    act(() => io.show(near("s3")));
    expect(screen.getByRole("img", { name: "Image crop: The source image was moved" })).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("replaces a failed image with a reason instead of a broken icon", () => {
    render(<FigureBlock block={figure("s4", "")} />, { wrapper: env });
    act(() => io.show(near("s4")));
    fireEvent.error(screen.getByRole("img", { name: "Figure" }));
    expect(
      screen.getByRole("img", { name: "Figure: The snapshot could not be loaded." }),
    ).toBeInTheDocument();
  });

  it("offers Retry on a failed image, which requests the same src again in a new img", () => {
    render(<FigureBlock block={figure("s6", "Crane")} />, { wrapper: env });
    act(() => io.show(near("s6")));
    const first = screen.getByRole("img", { name: "Crane" });
    fireEvent.error(first);
    expect(screen.getByRole("img", { name: "Crane: The snapshot could not be loaded." })).toBeInTheDocument();
    // The accessible name is specific to the figure, so it never collides with a section's own Retry.
    const retryButton = screen.getByRole("button", { name: "Retry Crane" });
    expect(retryButton).toHaveTextContent("Retry");
    fireEvent.click(retryButton);
    const again = screen.getByRole("img", { name: "Crane" });
    expect(again).not.toBe(first);
    expect(again).toHaveAttribute("src", "snap://s6");
    expect(screen.queryByRole("button", { name: "Retry Crane" })).toBeNull();
    expect(screen.getByTestId("snapshot-skeleton")).toBeInTheDocument();
  });

  it("offers no Retry when the source is missing or there is no backend", () => {
    render(<FigureBlock block={figure("s7", "Image crop", 170, 105, "The source image was moved")} />, {
      wrapper: env,
    });
    render(<FigureBlock block={figure("s8", "Plan")} />);
    act(() => io.show(() => true));
    expect(screen.getByRole("img", { name: "Image crop: The source image was moved" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Plan: Snapshots show/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
  });

  it("keys a row's figures by position, so a repeated snapshot key is not a duplicate React key", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <FigureRowBlock
        block={{ kind: "figure_row", figures: [figure("dup", "One", 40, 30), figure("dup", "Two", 40, 30)] }}
      />,
      { wrapper: env },
    );
    expect(err.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    err.mockRestore();
  });

  it("says why when there is no backend to ask", () => {
    render(<FigureBlock block={figure("s5", "Plan")} />); // default context: resolveSnapshot returns null
    act(() => io.show(near("s5")));
    expect(screen.getByRole("img", { name: /^Plan: Snapshots show/ })).toBeInTheDocument();
  });

  it("lays a row of figures side by side with their own names", () => {
    render(
      <FigureRowBlock
        block={{ kind: "figure_row", figures: [figure("a", "", 40, 30), figure("b", "North face", 40, 30)] }}
        altOf={(f, i) => `Photo ${i + 1}${f.caption ? `: ${f.caption}` : ""}`}
      />,
      { wrapper: env },
    );
    act(() => io.show(() => true));
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("alt"))).toEqual([
      "Photo 1",
      "Photo 2: North face",
    ]);
  });
});

describe("usePreviewEnv default context (Ruling R-6)", () => {
  it("yields the no-backend defaults outside a provider", () => {
    function Probe() {
      const env = usePreviewEnv();
      return (
        <ul>
          <li>resolveSnapshot: {String(env.resolveSnapshot(figure("x", "").snapshot))}</li>
          <li>resolveAsset: {String(env.resolveAsset("logo1"))}</li>
          <li>scrollRoot: {String(env.scrollRoot)}</li>
          <li>paper: {env.paper}</li>
        </ul>
      );
    }
    render(<Probe />);
    expect(screen.getByText("resolveSnapshot: null")).toBeInTheDocument();
    expect(screen.getByText("resolveAsset: null")).toBeInTheDocument();
    expect(screen.getByText("scrollRoot: null")).toBeInTheDocument();
    expect(screen.getByText("paper: A4")).toBeInTheDocument();
  });
});
