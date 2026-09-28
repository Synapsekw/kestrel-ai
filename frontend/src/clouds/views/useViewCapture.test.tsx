import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode, RefObject } from "react";
import type { ApiClient } from "@contract/client";
import { ApiFailure } from "@/api/errors";
import { TestApiProvider } from "@/test/render";
import { exampleFinding } from "@/test/findingFixtures";
import { measurementOf, POSE, viewOut } from "@/test/cloudViewFixtures";
import { useChangesStore } from "@/store/changes";
import { useToastStore } from "@/ui";
import type { CloudViewerHandle } from "../CloudViewer";
import type { CaptureResult } from "../viewer/capture";
import { setAnchorNormal } from "./normals";
import { NOT_SAVED, QUEUE_STOPPED, useViewCapture } from "./useViewCapture";
import { useViewStore } from "./viewStore";

const api = vi.hoisted(() => ({
  listCloudViews: vi.fn(),
  putFindingView3d: vi.fn(),
  putCloudMeasurementView3d: vi.fn(),
  fetchFinding: vi.fn(),
  listFindings: vi.fn(),
  listCloudMeasurements: vi.fn(),
}));
vi.mock("@/api/cloudViews", async (orig) => ({
  ...(await orig<object>()),
  listCloudViews: api.listCloudViews,
  putFindingView3d: api.putFindingView3d,
  putCloudMeasurementView3d: api.putCloudMeasurementView3d,
}));
vi.mock("@/api/findings", async (orig) => ({
  ...(await orig<object>()),
  fetchFinding: api.fetchFinding,
  listFindings: api.listFindings,
}));
vi.mock("@/api/cloudMeasurements", async (orig) => ({
  ...(await orig<object>()),
  listCloudMeasurements: api.listCloudMeasurements,
}));

const cloudFinding = (id: string) => ({
  ...exampleFinding,
  id,
  data_type: "point_cloud" as const,
  data_id: "c1",
  anchor: { kind: "cloud" as const, cloud_id: "c1", x: 10, y: 20, z: 5, uncertainty_m: 0.05 },
});
const RENDER = { colour_mode: "rgb" as const, point_budget: 3_000_000, point_size: 1.4, clip_box: null };
const result = (): CaptureResult => ({
  blob: new Blob([new Uint8Array(8)], { type: "image/png" }),
  width: 1600,
  height: 1000,
  complete: true,
  edl: false,
  pose: POSE,
});

function fakeViewer() {
  const h = {
    currentPose: vi.fn(() => POSE),
    canvasRect: vi.fn(() => ({ left: 0, top: 0, right: 1600, bottom: 1000 })),
    capture: vi.fn(async (): Promise<CaptureResult> => result()),
  };
  const ref = { current: h as unknown as CloudViewerHandle } as RefObject<CloudViewerHandle | null>;
  return { h, ref };
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <TestApiProvider api={{} as ApiClient}>{children}</TestApiProvider>
);

function mount(viewer = fakeViewer()) {
  const hook = renderHook(
    () => useViewCapture({ projectId: "p1", cloudId: "c1", viewer: viewer.ref, render: () => RENDER }),
    { wrapper },
  );
  return { ...hook, viewer };
}

describe("useViewCapture", () => {
  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.listCloudViews.mockResolvedValue({ items: [viewOut({ subject_id: "old" })] });
    api.putFindingView3d.mockImplementation(async (_a, _p, id: string) =>
      viewOut({ subject_id: id, sha256: "new" }),
    );
    api.putCloudMeasurementView3d.mockImplementation(async (_a, _p, _c, id: string) =>
      viewOut({ subject_kind: "cloud_measurement", subject_id: id }),
    );
    api.fetchFinding.mockImplementation(async (_a, _p, id: string) => ({
      ...cloudFinding(id),
      attachment_count: 0,
      comment_count: 0,
    }));
    useToastStore.getState().clear();
  });
  afterEach(() => setAnchorNormal("f1", null));

  it("loads the cloud's views and reports the viewer ready", async () => {
    mount();
    await waitFor(() => expect(useViewStore.getState().views).not.toBeNull());
    expect(api.listCloudViews).toHaveBeenCalledWith(expect.anything(), "p1", "c1");
    expect(useViewStore.getState()).toMatchObject({ projectId: "p1", cloudId: "c1", ready: true });
    expect(Object.keys(useViewStore.getState().views!)).toEqual(["finding:old"]);
  });

  it("captures a created finding on its anchor and uploads the normal", async () => {
    const { result: hook, viewer } = mount();
    setAnchorNormal("f1", [0, -1, 0]);
    act(() => hook.current.requestViewCapture({ kind: "finding", id: "f1" }, "create"));
    await waitFor(() => expect(api.putFindingView3d).toHaveBeenCalledTimes(1));
    const [pose, marks] = viewer.h.capture.mock.calls[0] as unknown as [
      { target: number[]; fov_deg: number },
      unknown,
    ];
    expect(pose.target).toEqual([10, 20, 5]);
    expect(pose.fov_deg).toBe(50);
    expect(marks).toEqual([{ kind: "finding", at: [10, 20, 5] }]);
    expect(api.putFindingView3d.mock.calls[0][4]).toMatchObject({
      render: { ...RENDER, edl: false, complete: true },
      anchor_normal: [0, -1, 0],
    });
    await waitFor(() => expect(useViewStore.getState().views?.["finding:f1"]?.sha256).toBe("new"));
    await waitFor(() => expect(useViewStore.getState().busy).toEqual({}));
  });

  it("keeps a fresher local write when a listCloudViews response lands after it", async () => {
    // The initial mount read is left in flight (resolved manually, below) while a capture's PUT
    // completes; its stale snapshot must not revert the just-saved view (reviewer finding).
    let resolveList!: (v: { items: ReturnType<typeof viewOut>[] }) => void;
    api.listCloudViews.mockImplementationOnce(() => new Promise((r) => (resolveList = r)));
    const { result: hook } = mount();
    setAnchorNormal("f1", [0, -1, 0]);
    act(() => hook.current.requestViewCapture({ kind: "finding", id: "f1" }, "create"));
    await waitFor(() => expect(useViewStore.getState().views?.["finding:f1"]?.sha256).toBe("new"));
    resolveList({ items: [viewOut({ subject_id: "old" })] });
    await new Promise((r) => setTimeout(r, 20));
    expect(useViewStore.getState().views?.["finding:f1"]?.sha256).toBe("new");
  });

  it("re-reads the views once after a burst of pointclouds.changed", async () => {
    mount();
    await waitFor(() => expect(api.listCloudViews).toHaveBeenCalledTimes(1));
    act(() => {
      for (let i = 0; i < 3; i += 1)
        useChangesStore.setState((s) => ({ pointcloudsRevision: s.pointcloudsRevision + 1 }));
    });
    await waitFor(() => expect(api.listCloudViews).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 500));
    expect(api.listCloudViews).toHaveBeenCalledTimes(2);
  });

  it("shows one quiet toast when an upload fails", async () => {
    api.putFindingView3d.mockRejectedValueOnce(new Error("422 bad_view_image"));
    const { result: hook } = mount();
    act(() => hook.current.requestViewCapture({ kind: "finding", id: "f1" }, "create"));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      tone: "info",
      text: expect.stringMatching(/report view was not saved/i),
    });
  });

  it("unmount resets the store and drops queued captures", async () => {
    const { result: hook, unmount, viewer } = mount();
    let release!: (r: CaptureResult) => void;
    viewer.h.capture.mockImplementationOnce(() => new Promise<CaptureResult>((r) => (release = r)));
    act(() => {
      hook.current.requestViewCapture({ kind: "finding", id: "f1" }, "create");
      hook.current.requestViewCapture({ kind: "finding", id: "f2" }, "create");
    });
    await waitFor(() => expect(viewer.h.capture).toHaveBeenCalledTimes(1));
    unmount();
    release(result());
    await new Promise((r) => setTimeout(r, 20));
    expect(api.putFindingView3d).not.toHaveBeenCalled();
    expect(viewer.h.capture).toHaveBeenCalledTimes(1);
    expect(useViewStore.getState()).toMatchObject({ cloudId: null, views: null, bulk: null, actions: null });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("captures the missing views with progress, then clears the progress", async () => {
    api.listFindings.mockResolvedValue({
      items: [cloudFinding("f1"), cloudFinding("old")],
      next_cursor: null,
    });
    api.listCloudMeasurements.mockResolvedValue([
      measurementOf(
        "distance",
        [
          [0, 0, 0],
          [2, 0, 0],
        ],
        null,
        "m1",
      ),
    ]);
    const { result: hook } = mount();
    const seen: string[] = [];
    const stop = useViewStore.subscribe((s) => {
      if (s.bulk) seen.push(`${s.bulk.done}/${s.bulk.total}`);
    });
    act(() => hook.current.captureMissing());
    await waitFor(() => expect(api.putCloudMeasurementView3d).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useViewStore.getState().bulk).toBeNull());
    stop();
    expect(api.listFindings).toHaveBeenCalledWith(expect.anything(), "p1", {
      anchor_kind: ["cloud"],
      data_id: "c1",
      limit: 500,
    });
    expect(api.putFindingView3d.mock.calls.map((c) => c[2])).toEqual(["f1"]);
    expect(api.putCloudMeasurementView3d.mock.calls.map((c) => c[3])).toEqual(["m1"]);
    expect(api.fetchFinding).not.toHaveBeenCalled(); // geometry came from the lists
    expect(seen).toEqual(expect.arrayContaining(["0/0", "0/2", "1/2", "2/2"]));
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      tone: "ok",
      text: "Saved 2 report views",
    });
  });

  it("cancel stops the bulk run after the capture in flight", async () => {
    api.listFindings.mockResolvedValue({
      items: [cloudFinding("f1"), cloudFinding("f2"), cloudFinding("f3")],
      next_cursor: null,
    });
    api.listCloudMeasurements.mockResolvedValue([]);
    api.listCloudViews.mockResolvedValue({ items: [] });
    const { result: hook, viewer } = mount();
    let release!: (r: CaptureResult) => void;
    viewer.h.capture.mockImplementationOnce(() => new Promise<CaptureResult>((r) => (release = r)));
    act(() => hook.current.captureMissing());
    await waitFor(() => expect(viewer.h.capture).toHaveBeenCalledTimes(1));
    act(() => hook.current.cancelMissing());
    expect(useViewStore.getState().bulk).toBeNull();
    release(result());
    await waitFor(() => expect(api.putFindingView3d).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(viewer.h.capture).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.at(-1)?.text).toBe("Stopped after 1 of 3 report views");
  });

  it("shows a mixed summary toast when some captures in a bulk run fail", async () => {
    api.listFindings.mockResolvedValue({
      items: [cloudFinding("f1"), cloudFinding("f2")],
      next_cursor: null,
    });
    api.listCloudMeasurements.mockResolvedValue([]);
    api.listCloudViews.mockResolvedValue({ items: [] });
    api.putFindingView3d.mockImplementation(async (_a, _p, id: string) =>
      id === "f2" ? Promise.reject(new Error("boom")) : viewOut({ subject_id: id, sha256: "new" }),
    );
    const { result: hook } = mount();
    act(() => hook.current.captureMissing());
    await waitFor(() => expect(useViewStore.getState().bulk).toBeNull());
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      tone: "info",
      text: "1 of 2 report views were not saved",
    });
  });

  it("counts a finding deleted mid-run (PUT 404) as skipped, not as not saved", async () => {
    api.listFindings.mockResolvedValue({
      items: [cloudFinding("f1"), cloudFinding("f2")],
      next_cursor: null,
    });
    api.listCloudMeasurements.mockResolvedValue([]);
    api.listCloudViews.mockResolvedValue({ items: [] });
    api.putFindingView3d.mockImplementation(async (_a, _p, id: string) =>
      id === "f2"
        ? Promise.reject(new ApiFailure("not_found", "Finding not found", 404))
        : viewOut({ subject_id: id, sha256: "new" }),
    );
    const { result: hook } = mount();
    act(() => hook.current.captureMissing());
    await waitFor(() => expect(useViewStore.getState().bulk).toBeNull());
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((t) => t.text)).not.toContain(NOT_SAVED);
    expect(toasts.at(-1)).toMatchObject({
      tone: "ok",
      text: "Saved 1 of 2 report views (1 skipped: no longer there)",
    });
  });

  it("stops the bulk run without a summary toast when the engine fails", async () => {
    api.listFindings.mockResolvedValue({
      items: [cloudFinding("f1"), cloudFinding("f2")],
      next_cursor: null,
    });
    api.listCloudMeasurements.mockResolvedValue([]);
    api.listCloudViews.mockResolvedValue({ items: [] });
    const { result: hook, viewer } = mount();
    viewer.h.capture.mockRejectedValueOnce(new Error("context lost"));
    act(() => hook.current.captureMissing());
    await waitFor(() => expect(useViewStore.getState().bulk).toBeNull());
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ tone: "info", text: QUEUE_STOPPED });
    expect(api.putFindingView3d).not.toHaveBeenCalled();
  });

  describe("a bulk run over subjects the operator touches meanwhile", () => {
    const moved = (id: string) => ({
      ...cloudFinding(id),
      anchor: { kind: "cloud" as const, cloud_id: "c1", x: 99, y: 20, z: 5, uncertainty_m: 0.05 },
      attachment_count: 0,
      comment_count: 0,
    });
    const marksFor = (h: ReturnType<typeof fakeViewer>["h"], i: number) =>
      (h.capture.mock.calls[i] as unknown as [unknown, unknown])[1];
    const putsFor = (id: string) => api.putFindingView3d.mock.calls.filter((c) => c[2] === id).length;

    beforeEach(() => {
      api.listCloudMeasurements.mockResolvedValue([]);
      api.listCloudViews.mockResolvedValue({ items: [] });
      api.fetchFinding.mockImplementation(async (_a, _p, id: string) => moved(id));
    });

    it("does not re-capture a subject an automatic request saved during the run", async () => {
      api.listFindings.mockResolvedValue({
        items: [cloudFinding("f1"), cloudFinding("f2"), cloudFinding("f3")],
        next_cursor: null,
      });
      let n = 0;
      api.putFindingView3d.mockImplementation(async (_a, _p, id: string) =>
        viewOut({ subject_id: id, sha256: `${id}-${(n += 1)}` }),
      );
      const { result: hook, viewer } = mount();
      let release!: (r: CaptureResult) => void;
      viewer.h.capture.mockImplementationOnce(() => new Promise<CaptureResult>((r) => (release = r)));
      act(() => hook.current.captureMissing());
      await waitFor(() => expect(viewer.h.capture).toHaveBeenCalledTimes(1)); // f1, held
      act(() => hook.current.requestViewCapture({ kind: "finding", id: "f3" }, "move"));
      release(result());
      await waitFor(() => expect(useViewStore.getState().bulk).toBeNull());
      expect(putsFor("f3")).toBe(1);
      expect(useViewStore.getState().views?.["finding:f3"]?.sha256).toBe("f3-2");
      expect(marksFor(viewer.h, 1)).toEqual([{ kind: "finding", at: [99, 20, 5] }]);
      expect(viewer.h.capture).toHaveBeenCalledTimes(3); // f1, f3 (move), f2 - not f3 again
      expect(useToastStore.getState().toasts.at(-1)?.text).toBe("Saved 3 report views");
    });

    it("a bulk item stopped by an engine failure leaves no stale geometry for a later request", async () => {
      api.listFindings.mockResolvedValue({ items: [cloudFinding("f1")], next_cursor: null });
      const { result: hook, viewer } = mount();
      let fail!: (e: Error) => void;
      viewer.h.capture.mockImplementationOnce(() => new Promise<CaptureResult>((_r, j) => (fail = j)));
      act(() => hook.current.requestViewCapture({ kind: "finding", id: "fa" }, "create"));
      await waitFor(() => expect(viewer.h.capture).toHaveBeenCalledTimes(1)); // fa, held
      act(() => hook.current.captureMissing());
      await waitFor(() => expect(useViewStore.getState().busy["finding:f1"]).toBe(true)); // f1 waits
      fail(new Error("context lost"));
      await waitFor(() => expect(useViewStore.getState().bulk).toBeNull());
      expect(api.putFindingView3d).not.toHaveBeenCalled();
      api.fetchFinding.mockClear();
      act(() => hook.current.requestViewCapture({ kind: "finding", id: "f1" }, "move"));
      await waitFor(() => expect(api.putFindingView3d).toHaveBeenCalledTimes(1));
      expect(api.fetchFinding).toHaveBeenCalledWith(expect.anything(), "p1", "f1");
      expect(marksFor(viewer.h, 1)).toEqual([{ kind: "finding", at: [99, 20, 5] }]);
    });

    it("a move merged into a waiting bulk item captures the moved anchor", async () => {
      api.listFindings.mockResolvedValue({ items: [cloudFinding("f1")], next_cursor: null });
      const { result: hook, viewer } = mount();
      let release!: (r: CaptureResult) => void;
      viewer.h.capture.mockImplementationOnce(() => new Promise<CaptureResult>((r) => (release = r)));
      act(() => hook.current.requestViewCapture({ kind: "finding", id: "fa" }, "create"));
      await waitFor(() => expect(viewer.h.capture).toHaveBeenCalledTimes(1)); // fa, held
      act(() => hook.current.captureMissing());
      await waitFor(() => expect(useViewStore.getState().busy["finding:f1"]).toBe(true)); // f1 waits
      act(() => hook.current.requestViewCapture({ kind: "finding", id: "f1" }, "move"));
      release(result());
      await waitFor(() => expect(useViewStore.getState().bulk).toBeNull());
      expect(putsFor("f1")).toBe(1);
      expect(marksFor(viewer.h, 1)).toEqual([{ kind: "finding", at: [99, 20, 5] }]);
    });
  });
});
