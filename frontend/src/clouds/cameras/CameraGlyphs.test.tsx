import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { imageJumpHref } from "@/clouds/jump";
import type { CloudToolId } from "@/clouds/workspace/tools";
import { cameraSet } from "@/test/cameraFixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { exampleImage, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { CameraGlyphs } from "./CameraGlyphs";
import { useCamerasStore } from "./store";

const E = 243550;
const N = 3178050;

/** World (E, N) lands on client (400, 300); 1 m = 1 px. `at.left` is where the next photo frame lands. */
function fakeViewer() {
  const restore = vi.fn();
  const at = { left: 10 };
  const v = {
    project: vi.fn((p: { x: number; y: number }) => ({ x: p.x - E + 400, y: N - p.y + 300 })),
    setOverlay: vi.fn(),
    pickAtClient: vi.fn(() => null),
    lookThrough: vi.fn<(pose: unknown) => unknown>(() => {
      const left = at.left;
      return {
        toCanvas: (u: number, w: number) => ({ x: u / 10, y: w / 10 }),
        frame: () => ({ left, top: 20, width: 204.8, height: 153.6 }),
        restore,
      };
    }),
  };
  const ref = createRef<CloudViewerHandle | null>() as { current: CloudViewerHandle | null };
  ref.current = v as unknown as CloudViewerHandle;
  return { v, ref, restore, at };
}

/** The viewer's canvas; "Reload view" re-creates the element, as `CloudViewer`'s `key={generation}` does. */
function ReloadableCanvas() {
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <canvas key={generation} data-testid="cloud-canvas" />
      <button type="button" onClick={() => setGeneration((g) => g + 1)}>
        Reload view
      </button>
    </>
  );
}

function click(x: number, y: number, x2 = x, y2 = y) {
  const canvas = screen.getByTestId("cloud-canvas");
  act(() => {
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: x2, clientY: y2, button: 0, bubbles: true }));
  });
}

function mount(tool: CloudToolId = "orbit") {
  const { v, ref, restore, at } = fakeViewer();
  const { api } = fakeClient([{ method: "GET", path: /\/images\/[^/]+$/, body: exampleImage }]);
  const r = renderWithProviders(
    <>
      <ReloadableCanvas />
      <CameraGlyphs projectId={PROJECT_ID} cloud={exampleCloud} viewer={ref} tool={tool} />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}` },
  );
  return { v, restore, at, unmount: r.unmount };
}

beforeEach(() => {
  const s = useCamerasStore.getState();
  s.reset(CLOUD_ID);
  s.receive(
    CLOUD_ID,
    cameraSet([
      { id: "img-posed", x: E, y: N, z: 30, yaw: 0, pitch: -90 },
      { id: "img-plain", x: E + 50, y: N, z: 30 },
    ]),
  );
});
afterEach(() => useCamerasStore.getState().reset(null));

describe("CameraGlyphs", () => {
  it("draws the glyphs and clears them when the switch goes off", () => {
    const { v } = mount();
    expect(v.setOverlay).toHaveBeenLastCalledWith("cameras", [
      expect.objectContaining({ kind: "segments" }),
      expect.objectContaining({ kind: "points", tone: "accent" }),
    ]);
    act(() => useCamerasStore.getState().setVisible(false));
    expect(v.setOverlay).toHaveBeenLastCalledWith("cameras", []);
  });

  it("a click within 8 px of a camera opens its popover even when the pick misses", async () => {
    mount();
    click(405, 304);
    const dialog = await screen.findByRole("dialog", { name: "Drone photo" });
    await screen.findByText(exampleImage.file_name);
    expect(dialog).toHaveTextContent(exampleImage.file_name);
  });

  it("a drag or a far click opens nothing", () => {
    mount();
    click(400, 300, 420, 300);
    click(430, 330);
    expect(screen.queryByRole("dialog", { name: "Drone photo" })).toBeNull();
  });

  it.each<CloudToolId>(["photo", "distance"])("ignores glyph clicks while the %s tool is armed", (tool) => {
    mount(tool);
    click(400, 300);
    expect(screen.queryByRole("dialog", { name: "Drone photo" })).toBeNull();
  });

  it("clicks still register after the canvas element is replaced (Reload view)", async () => {
    mount();
    const before = screen.getByTestId("cloud-canvas");
    fireEvent.click(screen.getByRole("button", { name: "Reload view" }));
    expect(screen.getByTestId("cloud-canvas")).not.toBe(before);
    click(400, 300);
    expect(await screen.findByRole("dialog", { name: "Drone photo" })).toBeInTheDocument();
  });

  it("Look through is disabled for a camera without angles", async () => {
    mount();
    click(450, 300);
    await screen.findByRole("dialog", { name: "Drone photo" });
    expect(screen.getByRole("button", { name: "Look through" })).toBeDisabled();
  });

  it("Look through takes the drone's pose, draws the photo frame, and Esc goes back", async () => {
    const { v, restore } = mount();
    click(400, 300);
    fireEvent.click(await screen.findByRole("button", { name: "Look through" }));
    expect(v.lookThrough).toHaveBeenCalledWith(
      expect.objectContaining({ position: [E, N, 30], width: 2048, height: 1536 }),
    );
    const frame = screen.getByTestId("look-through-frame");
    expect(frame.style.width).toBe("204.8px");
    expect(useCamerasStore.getState().lookingThrough).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(restore).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("look-through-frame")).toBeNull();
    expect(useCamerasStore.getState().lookingThrough).toBe(false);
  });

  it("without a running engine Look through draws nothing and keeps the popover", async () => {
    const { v } = mount();
    v.lookThrough.mockReturnValueOnce(null);
    click(400, 300);
    fireEvent.click(await screen.findByRole("button", { name: "Look through" }));
    expect(v.lookThrough).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("look-through-frame")).toBeNull();
    expect(useCamerasStore.getState().lookingThrough).toBe(false);
    expect(screen.getByRole("dialog", { name: "Drone photo" })).toBeInTheDocument();
  });

  it("a resize asks for the pose again and moves the frame", async () => {
    const { v, at } = mount();
    click(400, 300);
    fireEvent.click(await screen.findByRole("button", { name: "Look through" }));
    expect(screen.getByTestId("look-through-frame").style.left).toBe("10px");
    at.left = 50;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(v.lookThrough).toHaveBeenCalledTimes(2);
    expect(v.lookThrough.mock.calls[1][0]).toEqual(v.lookThrough.mock.calls[0][0]);
    expect(screen.getByTestId("look-through-frame").style.left).toBe("50px");
    expect(useCamerasStore.getState().lookingThrough).toBe(true);
  });

  it("unmounting while looking through clears lookingThrough", async () => {
    const { unmount } = mount();
    click(400, 300);
    fireEvent.click(await screen.findByRole("button", { name: "Look through" }));
    expect(useCamerasStore.getState().lookingThrough).toBe(true);
    unmount();
    expect(useCamerasStore.getState().lookingThrough).toBe(false);
  });

  it("starting to orbit leaves the photo frame without restoring", async () => {
    const { restore } = mount();
    click(400, 300);
    fireEvent.click(await screen.findByRole("button", { name: "Look through" }));
    click(100, 100, 160, 100);
    expect(screen.queryByTestId("look-through-frame")).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });

  it("Open in Images goes to the photo without a spot", async () => {
    mount();
    click(400, 300);
    fireEvent.click(await screen.findByRole("button", { name: "Open in Images" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        imageJumpHref(PROJECT_ID, "img-posed", CLOUD_ID, null),
      ),
    );
  });
});
