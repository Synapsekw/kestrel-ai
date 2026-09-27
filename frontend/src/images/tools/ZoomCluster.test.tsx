import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { makeDetail } from "@/images/canvas/testing";
import { ZoomCluster } from "./ZoomCluster";

const st = () => useImagesWorkspace.getState();

beforeEach(() => {
  st().reset();
  st().setViewport({ width: 1000, height: 800 });
  st().loadImage(makeDetail(), [], []);
});

describe("ZoomCluster", () => {
  it("shows the zoom in mono percent and zooms", async () => {
    render(<ZoomCluster />);
    act(() => st().setView({ scale: 0.74, x: 0, y: 0 }));
    expect(screen.getByText("74%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(st().view.scale).toBeGreaterThan(0.74);
    await userEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(st().fitted).toBe(true);
  });

  it("toggles Keep zoom from its menu", async () => {
    render(<ZoomCluster />);
    await userEvent.click(screen.getByRole("button", { name: "Zoom options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Keep zoom/ }));
    expect(st().keepZoom).toBe(true);
  });
});
