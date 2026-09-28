import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudViewMeta, CloudViewOut, CloudViewPose } from "@contract/client";
import { ApiFailure } from "@/api/errors";
import { measurementOf, POSE, viewOut } from "@/test/cloudViewFixtures";
import { VIEW_MAX_BYTES, type CaptureMark, type CaptureResult } from "../viewer/capture";
import type { ViewSubject } from "../workspace/seams";
import type { CaptureEngine } from "./captureEngine";
import { setAnchorNormal } from "./normals";
import { CaptureQueue, normalFor, poseFor, type QueueDeps, type SubjectGeometry } from "./queue";

const F1 = { kind: "finding" as const, id: "f1" };
const F2 = { kind: "finding" as const, id: "f2" };
const CLIP = { centre: [1, 2, 3], size: [4, 5, 6], yaw_deg: 0, mode: "show_inside" as const };
const RENDER = { colour_mode: "rgb" as const, point_budget: 3_000_000, point_size: 1.4, clip_box: CLIP };

const shot = (over: Partial<CaptureResult> = {}): CaptureResult => ({
  blob: new Blob([new Uint8Array(10)], { type: "image/png" }),
  width: 1600,
  height: 1000,
  complete: true,
  edl: false,
  pose: POSE,
  ...over,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

function harness(over: Partial<QueueDeps> = {}) {
  const engine = {
    currentPose: vi.fn((): CloudViewPose | null => POSE),
    capture: vi.fn<(pose: CloudViewPose, marks: readonly CaptureMark[]) => Promise<CaptureResult>>(async () =>
      shot(),
    ),
  } satisfies CaptureEngine;
  const uploads: { subject: string; meta: CloudViewMeta; image: Blob }[] = [];
  const deps: QueueDeps = {
    engine: () => engine,
    resolve: vi.fn(async (s): Promise<SubjectGeometry> => ({
      kind: "finding",
      anchor: s.id === "f1" ? [1, 2, 3] : [4, 5, 6],
    })),
    storedView: () => null,
    render: () => RENDER,
    upload: vi.fn(async (s, image, meta) => {
      uploads.push({ subject: s.id, meta, image });
      return viewOut({ subject_id: s.id });
    }),
    onView: vi.fn(),
    onBusy: vi.fn(),
    onFail: vi.fn(),
    ...over,
  };
  return { engine, deps, uploads, queue: new CaptureQueue(deps) };
}

describe("poses and normals per reason", () => {
  const geomF: SubjectGeometry = { kind: "finding", anchor: [10, 10, 10] };
  it("frames create/move on the anchor and refresh on the exact current pose", () => {
    expect(poseFor("create", geomF, POSE, null).target).toEqual([10, 10, 10]);
    expect(poseFor("move", geomF, POSE, null).fov_deg).toBe(50);
    expect(poseFor("refresh", geomF, POSE, null)).toEqual(POSE);
  });
  it("frames a measurement save on its sphere", () => {
    const m = measurementOf("distance", [
      [0, 0, 0],
      [2, 0, 0],
    ]);
    expect(poseFor("save", { kind: "cloud_measurement", measurement: m }, POSE, null).target).toEqual([
      1, 0, 0,
    ]);
  });
  it("reuses a stored pose for a missing view, re-targeted when stale", () => {
    const stored = viewOut({ pose: { position: [0, -5, 5], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 40 } });
    expect(poseFor("missing", geomF, POSE, stored)).toEqual(stored.pose);
    expect(poseFor("missing", geomF, POSE, { ...stored, stale: true })).toEqual({
      position: [10, 5, 15],
      target: [10, 10, 10],
      up: [0, 0, 1],
      fov_deg: 40,
    });
    expect(poseFor("missing", geomF, POSE, null).fov_deg).toBe(50);
  });
  it("sends the fresh normal on create and falls back to a current stored one otherwise", () => {
    setAnchorNormal("f1", null);
    const stored = viewOut({ anchor_normal: [1, 0, 0] });
    expect(normalFor(F1, "create", stored)).toBeNull();
    expect(normalFor(F1, "refresh", stored)).toEqual([1, 0, 0]);
    expect(normalFor(F1, "refresh", { ...stored, stale: true })).toBeNull();
    setAnchorNormal("f1", [0, 0, 1]);
    expect(normalFor(F1, "create", stored)).toEqual([0, 0, 1]);
    expect(normalFor({ kind: "cloud_measurement", id: "m1" }, "save", stored)).toBeNull();
    setAnchorNormal("f1", null);
  });
});

describe("the capture queue", () => {
  beforeEach(() => setAnchorNormal("f1", null));

  it("runs captures one at a time, in order, and uploads the meta", async () => {
    const { queue, engine, uploads, deps } = harness();
    const first = deferred<CaptureResult>();
    engine.capture.mockImplementationOnce(() => first.promise);
    setAnchorNormal("f1", [0, 1, 0]);
    const a = queue.enqueue(F1, "create");
    const b = queue.enqueue(F2, "create");
    await vi.waitFor(() => expect(engine.capture).toHaveBeenCalledTimes(1));
    first.resolve(shot({ complete: false }));
    expect(await a).toBe("saved");
    expect(await b).toBe("saved");
    expect(engine.capture).toHaveBeenCalledTimes(2);
    expect(engine.capture.mock.calls[0][1]).toEqual([{ kind: "finding", at: [1, 2, 3] }]);
    expect(uploads.map((u) => u.subject)).toEqual(["f1", "f2"]);
    expect(uploads[0].meta).toEqual({
      pose: expect.objectContaining({ target: [1, 2, 3], fov_deg: 50 }),
      render: { ...RENDER, edl: false, complete: false },
      anchor_normal: [0, 1, 0],
    });
    expect(deps.onView).toHaveBeenCalledTimes(2);
    expect(deps.onBusy).toHaveBeenCalledWith("finding:f1", true);
    expect(deps.onBusy).toHaveBeenLastCalledWith("finding:f2", false);
  });

  it("a subject queued twice runs once with the later reason", async () => {
    const { queue, engine, uploads } = harness();
    const first = deferred<CaptureResult>();
    engine.capture.mockImplementationOnce(() => first.promise);
    const running = queue.enqueue(F2, "create");
    await vi.waitFor(() => expect(engine.capture).toHaveBeenCalledTimes(1));
    const a = queue.enqueue(F1, "create");
    const b = queue.enqueue(F1, "refresh");
    first.resolve(shot());
    expect([await running, await a, await b]).toEqual(["saved", "saved", "saved"]);
    expect(uploads.map((u) => u.subject)).toEqual(["f2", "f1"]);
    expect(uploads[1].meta.pose).toEqual(POSE); // refresh: the exact current pose, not auto framing
  });

  it("a missing merged onto a waiting move keeps the move (the stronger reason)", async () => {
    const { queue, engine, uploads } = harness({
      storedView: (s) =>
        s.id === "f1"
          ? viewOut({ pose: { position: [0, -5, 5], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 40 } })
          : null,
    });
    const first = deferred<CaptureResult>();
    engine.capture.mockImplementationOnce(() => first.promise);
    const running = queue.enqueue(F2, "create");
    await vi.waitFor(() => expect(engine.capture).toHaveBeenCalledTimes(1));
    const a = queue.enqueue(F1, "move");
    const b = queue.enqueue(F1, "missing", { quiet: true });
    first.resolve(shot());
    expect([await running, await a, await b]).toEqual(["saved", "saved", "saved"]);
    expect(uploads[1].meta.pose.target).toEqual([1, 2, 3]); // auto-framed on the anchor, not the stored pose
  });

  it("a move merged onto a waiting missing replaces it", async () => {
    const { queue, engine, uploads } = harness({
      storedView: () =>
        viewOut({ pose: { position: [0, -5, 5], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 40 } }),
    });
    const first = deferred<CaptureResult>();
    engine.capture.mockImplementationOnce(() => first.promise);
    const running = queue.enqueue(F2, "create");
    await vi.waitFor(() => expect(engine.capture).toHaveBeenCalledTimes(1));
    const a = queue.enqueue(F1, "missing", { quiet: true });
    const b = queue.enqueue(F1, "move");
    first.resolve(shot());
    expect([await running, await a, await b]).toEqual(["saved", "saved", "saved"]);
    expect(uploads[1].meta.pose.target).toEqual([1, 2, 3]);
  });

  it("dispose during a capture uploads nothing and reports nothing", async () => {
    const { queue, engine, deps } = harness();
    const first = deferred<CaptureResult>();
    engine.capture.mockImplementationOnce(() => first.promise);
    const a = queue.enqueue(F1, "create");
    const b = queue.enqueue(F2, "create");
    await vi.waitFor(() => expect(engine.capture).toHaveBeenCalledTimes(1));
    queue.dispose();
    expect(await b).toBe("stopped");
    // the running job's busy flag is cleared immediately at dispose, not left dangling
    // until its capture eventually settles (it must not survive into a later queue's state).
    expect(deps.onBusy).toHaveBeenCalledWith("finding:f1", false);
    vi.mocked(deps.onBusy).mockClear();
    first.resolve(shot());
    expect(await a).toBe("stopped");
    expect(deps.onBusy).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.onFail).not.toHaveBeenCalled();
    expect(deps.onView).not.toHaveBeenCalled();
    expect(await queue.enqueue(F1, "refresh")).toBe("stopped");
  });

  it("dispose during an upload aborts the signal and ignores a late success", async () => {
    const uploadDone = deferred<CloudViewOut>();
    let signalSeen: AbortSignal | undefined;
    const upload = vi.fn((_subject: ViewSubject, _image: Blob, _meta: CloudViewMeta, signal: AbortSignal) => {
      signalSeen = signal;
      return uploadDone.promise;
    });
    const { queue, deps } = harness({ upload });
    const a = queue.enqueue(F1, "create");
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    queue.dispose();
    expect(signalSeen?.aborted).toBe(true);
    vi.mocked(deps.onBusy).mockClear();
    uploadDone.resolve(viewOut({ subject_id: "f1" }));
    expect(await a).toBe("stopped");
    expect(deps.onView).not.toHaveBeenCalled();
    expect(deps.onBusy).not.toHaveBeenCalled();
  });

  it("a capture failure stops the queue with one report and the queue recovers", async () => {
    const { queue, engine, deps, uploads } = harness();
    engine.capture.mockRejectedValueOnce(new Error("context lost"));
    const a = queue.enqueue(F1, "create");
    const b = queue.enqueue(F2, "create", { quiet: true });
    expect([await a, await b]).toEqual(["stopped", "stopped"]);
    expect(deps.onFail).toHaveBeenCalledTimes(1);
    expect(deps.onFail).toHaveBeenCalledWith(F1, expect.any(Error), true);
    expect(await queue.enqueue(F2, "refresh")).toBe("saved");
    expect(uploads.map((u) => u.subject)).toEqual(["f2"]);
  });

  it("stops without a viewer or without a current pose", async () => {
    const none = harness({ engine: () => null });
    expect(await none.queue.enqueue(F1, "create")).toBe("stopped");
    expect(none.deps.onFail).toHaveBeenCalledWith(F1, expect.any(Error), true);
    const blind = harness();
    blind.engine.currentPose.mockReturnValue(null);
    expect(await blind.queue.enqueue(F1, "create")).toBe("stopped");
  });

  it("an upload failure fails that job only, and a quiet job reports nothing", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error("422 bad_view_image"))
      .mockRejectedValueOnce(new Error("422 bad_view_image"))
      .mockResolvedValue(viewOut({ subject_id: "f2" }));
    const { queue, deps } = harness({ upload });
    expect(await queue.enqueue(F1, "create")).toBe("failed");
    expect(await queue.enqueue(F1, "missing", { quiet: true })).toBe("failed");
    expect(await queue.enqueue(F2, "create")).toBe("saved");
    expect(deps.onFail).toHaveBeenCalledTimes(1);
    expect(deps.onFail).toHaveBeenCalledWith(F1, expect.any(Error), false);
  });

  it("a bulk missing job whose PUT answers not_found (the subject is gone) is a quiet skip", async () => {
    const gone = new ApiFailure("not_found", "Finding not found", 404);
    const upload = vi.fn().mockRejectedValue(gone);
    const { queue, deps } = harness({ upload });
    expect(await queue.enqueue(F1, "missing", { quiet: true })).toBe("skipped");
    expect(deps.onFail).not.toHaveBeenCalled();
    expect(deps.onBusy).toHaveBeenLastCalledWith("finding:f1", false);
  });

  it("an explicit capture of a deleted subject, or another 404, still fails", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new ApiFailure("not_found", "Finding not found", 404))
      .mockRejectedValueOnce(new ApiFailure("cloud_gone", "Point cloud not found", 404));
    const { queue, deps } = harness({ upload });
    expect(await queue.enqueue(F1, "refresh")).toBe("failed");
    expect(deps.onFail).toHaveBeenCalledWith(F1, expect.any(ApiFailure), false);
    expect(await queue.enqueue(F1, "missing", { quiet: true })).toBe("failed");
  });

  it("an image over 6 MiB is not uploaded", async () => {
    const { queue, engine, uploads } = harness();
    engine.capture.mockResolvedValueOnce(
      shot({ blob: new Blob([new Uint8Array(VIEW_MAX_BYTES + 1)], { type: "image/jpeg" }) }),
    );
    expect(await queue.enqueue(F1, "create")).toBe("failed");
    expect(await queue.enqueue(F2, "create")).toBe("saved");
    expect(uploads.map((u) => u.subject)).toEqual(["f2"]);
  });

  it("a subject that cannot be resolved fails without capturing", async () => {
    const { queue, engine } = harness({ resolve: vi.fn().mockRejectedValue(new Error("404 not_found")) });
    expect(await queue.enqueue(F1, "create")).toBe("failed");
    expect(engine.capture).not.toHaveBeenCalled();
  });

  it("passes the stored view to the pose rule", async () => {
    const stored: CloudViewOut = viewOut({
      pose: { position: [0, -5, 5], target: [1, 2, 3], up: [0, 0, 1], fov_deg: 33 },
    });
    const { queue, uploads } = harness({ storedView: () => stored });
    await queue.enqueue(F1, "missing");
    expect(uploads[0].meta.pose.fov_deg).toBe(33);
  });
});
