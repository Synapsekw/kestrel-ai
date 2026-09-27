import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { CloudViewer, type CloudViewerHandle } from "./CloudViewer";

// jsdom has no WebGL: `canvas.getContext("webgl2")` answers null, as a machine whose graphics
// driver cannot start WebGL does, so three's renderer throws on construction.
describe("CloudViewer without WebGL", () => {
  it("says the 3D view cannot start instead of taking the screen down", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <CloudViewer
        cloud={exampleCloud}
        octreeUrl="http://127.0.0.1:1/octree/"
        token="t"
        budget={3_000_000}
        colour="rgb"
        elevationRange={[0, 1]}
        pointSize={1}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The 3D view could not start");
    expect(alert).toHaveTextContent("WebGL");
    expect(screen.getByTestId("cloud-canvas")).toBeInTheDocument();
  });

  it("reports that the view cannot start, so the workspace hides the panels that need it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const states: string[] = [];
    render(
      <CloudViewer
        cloud={exampleCloud}
        octreeUrl="http://127.0.0.1:1/octree/"
        token="t"
        budget={3_000_000}
        colour="rgb"
        elevationRange={[0, 1]}
        pointSize={1}
        onViewState={(s) => states.push(s)}
      />,
    );
    expect(states).toEqual(["no-webgl"]);
    expect(screen.queryByTestId("cloud-points-shown")).toBeNull(); // the S1 status bar is gone
  });
});

describe("CloudViewer handle without an engine", () => {
  it("answers every handle member without WebGL, and nothing throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = createRef<CloudViewerHandle>();
    render(
      <CloudViewer
        ref={ref}
        cloud={exampleCloud}
        octreeUrl="http://127.0.0.1:1/octree/"
        token="t"
        budget={3_000_000}
        colour="intensity"
        elevationRange={[0, 1]}
        pointSize={1}
      />,
    );
    const h = ref.current!;
    expect(() => {
      h.setView("iso");
      h.setNavMode("pan");
      h.setColourMode("classification");
      h.setClassVisibility(new Set([2]));
      h.goToPose({ position: [0, 0, 10], target: [0, 1, 0], up: [0, 0, 1], fov_deg: 60 });
      h.fit();
      h.topView();
      h.setEdl(false);
      h.requestRender();
    }).not.toThrow();
    expect(h.navMode()).toBe("pan"); // the shell keeps it for the next engine
    expect(h.frameTimes()).toEqual([]);
    expect(h.currentPose()).toBeNull();
    expect(h.colourAvailability()).toBeNull();
    expect(h.edl()).toBeNull();
    const off = h.onFrame(() => {});
    expect(typeof off).toBe("function");
    off();
    await expect(h.topSnapshot()).resolves.toBeNull();
    expect(h.pickAtClient(1, 1)).toBeNull();
    expect(h.stats().numVisiblePoints).toBe(0);
  });
});
