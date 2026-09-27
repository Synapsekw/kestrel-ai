import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { CloudViewer, type CloudViewerHandle } from "./CloudViewer";
import { canClip } from "./workspace/clipEngine";

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

describe("CloudViewer notices (no WebGL, load error, lost context)", () => {
  it("sit above the workspace's glass panels, in the band the workspace leaves free", () => {
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
        noticeInset={{ left: 368, right: 358, top: 66 }}
      />,
    );
    const host = screen.getByTestId("cloud-viewer-notice");
    expect(host).toContainElement(screen.getByRole("alert"));
    // Panels are z 10 and the hint bar z 20 (spec §6 stack); the notice sits between them.
    expect(host).toHaveClass("z-[15]");
    expect(host).toHaveStyle({ left: "368px", right: "358px", top: "66px" });
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

describe("CloudViewer C-V2 members without an engine", () => {
  it("answer null or reject, and nothing throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ref = createRef<CloudViewerHandle>();
    render(
      <CloudViewer
        ref={ref}
        cloud={exampleCloud}
        octreeUrl="http://127.0.0.1:1/octree/"
        token="t"
        budget={3_000_000}
        colour="rgb"
        elevationRange={[0, 1]}
        pointSize={1}
      />,
    );
    const h = ref.current!;
    // W1's structural probe sees V2's clip box on the real handle: Fly and Clip are enabled
    expect(canClip(h)).toBe(true);
    expect(() => h.setClipBox({ centre: [0, 0, 0], size: [1, 1, 1], yawDeg: 0 })).not.toThrow();
    // the shell keeps the clip box for the next engine (it survives a rebuild, like the nav mode)
    expect(h.clipBox()).toEqual({
      box: { centre: [0, 0, 0], size: [1, 1, 1], yawDeg: 0 },
      mode: "show_inside",
    });
    expect(
      h.lookThrough({
        position: [0, 0, 1],
        forward: [0, 0, -1],
        up: [0, 1, 0],
        hfovDeg: 70,
        vfovDeg: 50,
        width: 4,
        height: 3,
      }),
    ).toBeNull();
    expect(h.occlusion([[0, 0, 0]], [0.3])).toBeNull();
    expect(h.pickWithNormal(1, 1)).toBeNull();
    const off = h.onSettle(() => {});
    expect(typeof off).toBe("function");
    off();
    await expect(h.sampleSlab([0, 0, 0], [1, 0, 0], 1)).rejects.toThrow("not running");
    await expect(
      h.capture({ position: [0, -1, 1], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 50 }, []),
    ).rejects.toThrow("not running");
  });
});
