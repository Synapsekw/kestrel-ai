import { describe, expect, it, vi } from "vitest";
import { POSE } from "@/test/cloudViewFixtures";
import type { CloudViewerHandle } from "../CloudViewer";
import { CAPTURE_TIMEOUT_MS } from "../viewer/capture";
import { captureEngineFrom } from "./captureEngine";

function fakeHandle() {
  const h = {
    currentPose: vi.fn(() => POSE),
    canvasRect: vi.fn(() => ({ left: 0, top: 0, right: 1600, bottom: 1000 })),
    capture: vi.fn(async () => ({
      blob: new Blob(["x"]),
      width: 1600,
      height: 1000,
      complete: true,
      edl: false,
      pose: POSE,
    })),
  };
  return { h, handle: h as unknown as CloudViewerHandle };
}

describe("the capture engine adapter", () => {
  it("copies the current pose and passes null through", () => {
    const { h, handle } = fakeHandle();
    const engine = captureEngineFrom(handle);
    const pose = engine.currentPose()!;
    expect(pose).toEqual(POSE); // a 1.6 canvas keeps the fov
    expect(pose.position).not.toBe(POSE.position);
    h.currentPose.mockReturnValueOnce(null as never);
    expect(engine.currentPose()).toBeNull();
  });

  it("crops the fov to 1.6 on a narrower canvas and leaves it on a wider or missing one", () => {
    const { h, handle } = fakeHandle();
    const engine = captureEngineFrom(handle);
    h.canvasRect.mockReturnValueOnce({ left: 0, top: 0, right: 1000, bottom: 1000 });
    expect(engine.currentPose()!.fov_deg).toBeCloseTo(39.68, 1); // 2·atan(tan 30° · 1 / 1.6)
    h.canvasRect.mockReturnValueOnce({ left: 0, top: 0, right: 2000, bottom: 1000 });
    expect(engine.currentPose()!.fov_deg).toBe(60);
    h.canvasRect.mockReturnValueOnce(null as never);
    expect(engine.currentPose()!.fov_deg).toBe(60);
  });

  it("captures with the 10 s timeout", async () => {
    const { h, handle } = fakeHandle();
    const shot = await captureEngineFrom(handle).capture(POSE, [{ kind: "finding", at: [0, 0, 0] }]);
    expect(h.capture).toHaveBeenCalledWith(POSE, [{ kind: "finding", at: [0, 0, 0] }], {
      timeoutMs: CAPTURE_TIMEOUT_MS,
    });
    expect(shot).toMatchObject({ complete: true, edl: false });
  });
});
