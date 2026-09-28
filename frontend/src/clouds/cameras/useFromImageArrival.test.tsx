import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { useToastStore } from "@/ui";
import { cameraSet } from "@/test/cameraFixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { PROJECT_ID } from "@/test/fixtures";
import { useCamerasStore } from "./store";
import { FROM_IMAGE_OVERLAY, NO_POSE_TOAST, OUTSIDE_TOAST, useFromImageArrival } from "./useFromImageArrival";

const E = 243550;
const N = 3178050;
const SET = cameraSet([
  { id: "img-posed", x: E, y: N, z: 30, yaw: 0, pitch: -90 },
  { id: "img-plain", x: E + 10, y: N, z: 30 },
]);
const HIT = { x: E + 1, y: N + 2, z: 1, level: 5, uncertainty_m: 0.05 };

function viewer(hit: typeof HIT | null = HIT) {
  const v = {
    stats: vi.fn(() => ({ numVisiblePoints: 1000, nodesLoading: 0 })),
    lookThrough: vi.fn(() => ({
      toCanvas: (u: number, w: number) => ({ x: u / 2, y: w / 2 }),
      frame: () => ({ left: 0, top: 0, width: 1024, height: 768 }),
      restore: vi.fn(),
    })),
    pickAtClient: vi.fn(() => hit),
    setOverlay: vi.fn(),
    lookAt: vi.fn(),
  };
  const ref = createRef<CloudViewerHandle | null>() as { current: CloudViewerHandle | null };
  ref.current = v as unknown as CloudViewerHandle;
  return { v, ref };
}

function Harness({ v }: { v: { current: CloudViewerHandle | null } }) {
  const loc = useLocation();
  useFromImageArrival(v, exampleCloud, loc.search);
  return <output data-testid="location">{loc.pathname + loc.search}</output>;
}

function mount(query: string, hit: typeof HIT | null = HIT) {
  const { v, ref } = viewer(hit);
  render(
    <MemoryRouter initialEntries={[`/p/${PROJECT_ID}/clouds/${CLOUD_ID}${query}`]}>
      <Harness v={ref} />
    </MemoryRouter>,
  );
  return v;
}

const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const tick = (n: number) => act(() => void vi.advanceTimersByTime(100 * n));

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.getState().clear();
  const s = useCamerasStore.getState();
  s.reset(CLOUD_ID);
  s.receive(CLOUD_ID, SET);
});
afterEach(() => {
  vi.useRealTimers();
  useCamerasStore.getState().reset(null);
});

describe("useFromImageArrival", () => {
  it("looks through the posed drone, picks at the photo pixel, marks the hit and targets the orbit on it", () => {
    const v = mount("?from_image=img-posed&px=1024,768");
    tick(1);
    expect(v.lookThrough).toHaveBeenCalledWith(expect.objectContaining({ position: [E, N, 30] }));
    tick(2);
    expect(v.pickAtClient).toHaveBeenCalledWith(512, 384);
    expect(v.setOverlay).toHaveBeenCalledWith(FROM_IMAGE_OVERLAY, [
      expect.objectContaining({ kind: "line", tone: "accent" }),
      expect.objectContaining({ kind: "points", tone: "accent" }),
    ]);
    const d = Math.hypot(1, 2, 29);
    expect(v.lookAt).toHaveBeenCalledWith({ x: HIT.x, y: HIT.y, z: HIT.z }, d);
    tick(10);
    expect(v.pickAtClient).toHaveBeenCalledTimes(1);
  });

  it("waits for the view to settle before picking", () => {
    const v = mount("?from_image=img-posed&px=1024,768");
    v.stats.mockReturnValue({ numVisiblePoints: 1000, nodesLoading: 3 });
    tick(5);
    expect(v.pickAtClient).not.toHaveBeenCalled();
    v.stats.mockReturnValue({ numVisiblePoints: 1000, nodesLoading: 0 });
    tick(2);
    expect(v.pickAtClient).toHaveBeenCalledTimes(1);
  });

  it("a position-only photo falls back to the drone's XY with the S1 jump", () => {
    const v = mount("?from_image=img-plain&px=10,10");
    expect(toasts()).toContain(NO_POSE_TOAST);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?at=243560.000,3178050.000`,
    );
    tick(5);
    expect(v.lookThrough).not.toHaveBeenCalled();
  });

  it("a posed photo whose pixel hits nothing falls back after three settled rounds", () => {
    mount("?from_image=img-posed&px=1024,768", null);
    tick(5);
    expect(toasts()).toContain(NO_POSE_TOAST);
    expect(screen.getByTestId("location")).toHaveTextContent("?at=243550.000,3178050.000");
  });

  it("a photo that is not near the cloud toasts outside and does nothing else", () => {
    const v = mount("?from_image=img-unknown&px=10,10");
    expect(toasts()).toEqual([OUTSIDE_TOAST]);
    tick(5);
    expect(v.lookThrough).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent("from_image=img-unknown");
  });

  it("cameras that could not be placed count as outside", () => {
    useCamerasStore.getState().fail(CLOUD_ID, "needs_coordinates", null);
    mount("?from_image=img-posed&px=1,1");
    expect(toasts()).toEqual([OUTSIDE_TOAST]);
  });

  it("waits for the cameras to load", () => {
    useCamerasStore.getState().reset(CLOUD_ID);
    const v = mount("?from_image=img-posed&px=1024,768");
    tick(3);
    expect(v.lookThrough).not.toHaveBeenCalled();
    act(() => useCamerasStore.getState().receive(CLOUD_ID, SET));
    tick(1);
    expect(v.lookThrough).toHaveBeenCalledOnce();
  });

  it("a second pick round uses a fresh lookThrough result, not a cached handle", () => {
    let calls = 0;
    const lookThrough = vi.fn(() => {
      calls += 1;
      const n = calls;
      return {
        toCanvas: () => ({ x: n, y: n }),
        frame: () => ({ left: 0, top: 0, width: 1024, height: 768 }),
        restore: vi.fn(),
      };
    });
    const pickAtClient = vi.fn().mockReturnValueOnce(null).mockReturnValue(HIT);
    const v = {
      stats: vi.fn(() => ({ numVisiblePoints: 1000, nodesLoading: 0 })),
      lookThrough,
      pickAtClient,
      setOverlay: vi.fn(),
      lookAt: vi.fn(),
    };
    const ref = createRef<CloudViewerHandle | null>() as { current: CloudViewerHandle | null };
    ref.current = v as unknown as CloudViewerHandle;
    render(
      <MemoryRouter initialEntries={[`/p/${PROJECT_ID}/clouds/${CLOUD_ID}?from_image=img-posed&px=1024,768`]}>
        <Harness v={ref} />
      </MemoryRouter>,
    );
    tick(4);
    // One call to pose (its toCanvas is never used), then one fresh call per settled pick round:
    // a miss at n=2, a hit at n=3. A cached handle would call `toCanvas` only through call #1 or
    // #2 and every round would report the same coordinates.
    expect(lookThrough).toHaveBeenCalledTimes(3);
    expect(pickAtClient).toHaveBeenCalledTimes(2);
    expect(pickAtClient).toHaveBeenNthCalledWith(1, 2, 2);
    expect(pickAtClient).toHaveBeenNthCalledWith(2, 3, 3);
  });

  it("retries when lookThrough answers null (no running engine yet), without crashing", () => {
    let calls = 0;
    const lookThrough = vi.fn(() => {
      calls += 1;
      if (calls < 3) return null; // the engine is not mounted on the first two polls
      return {
        toCanvas: (u: number, w: number) => ({ x: u / 2, y: w / 2 }),
        frame: () => ({ left: 0, top: 0, width: 1024, height: 768 }),
        restore: vi.fn(),
      };
    });
    const v = {
      stats: vi.fn(() => ({ numVisiblePoints: 1000, nodesLoading: 0 })),
      lookThrough,
      pickAtClient: vi.fn(() => HIT),
      setOverlay: vi.fn(),
      lookAt: vi.fn(),
    };
    const ref = createRef<CloudViewerHandle | null>() as { current: CloudViewerHandle | null };
    ref.current = v as unknown as CloudViewerHandle;
    expect(() =>
      render(
        <MemoryRouter
          initialEntries={[`/p/${PROJECT_ID}/clouds/${CLOUD_ID}?from_image=img-posed&px=1024,768`]}
        >
          <Harness v={ref} />
        </MemoryRouter>,
      ),
    ).not.toThrow();
    expect(() => tick(10)).not.toThrow();
    expect(v.pickAtClient).toHaveBeenCalled();
  });

  it("ignores URLs without a from_image arrival", () => {
    const v = mount("?at=243550,3178050");
    tick(5);
    expect(v.lookThrough).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });
});
