import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CloudPick, CloudViewerHandle } from "@/clouds/CloudViewer";
import type { Vec3 } from "@/clouds/viewer/types";
import { getAnchorNormal } from "@/clouds/views/normals";
import type { WorkspaceSeams } from "@/clouds/workspace/seams";
import { useChangesStore } from "@/store/changes";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { exampleFindingDetail, TYPE_SPALLING } from "@/test/findingFixtures";
import { CLOUD_ID } from "@/test/cloudFixtures";
import { TestApiProvider } from "@/test/render";
import { LAST_TYPE_KEY, normalAt, readLastType, usePinTool } from "./usePinTool";
import { at } from "./testCamera";

const pick = (p: Vec3): CloudPick => ({ x: p[0], y: p[1], z: p[2], level: 3, uncertainty_m: 0.01 });

const UP: Vec3 = [0, 0, 1];

/** A viewer whose normal pick at the projected spot answers a level surface. */
function viewer(): { current: CloudViewerHandle } {
  return {
    current: {
      project: () => ({ x: 400, y: 250 }),
      pickWithNormal: () => ({ point: at(0, 0, 0), u: 0.01, normal: UP }),
    } as unknown as CloudViewerHandle,
  };
}

function setup(routes: FakeRoute[], cloudId: string | null = CLOUD_ID) {
  const { api, requests } = fakeClient(routes);
  const seen: [string, string, Vec3 | null][] = [];
  const seams: WorkspaceSeams = {
    requestViewCapture: vi.fn((s, reason) => seen.push([s.id, reason, getAnchorNormal(s.id)])),
    ReportViewCard: null,
    LikelyViews: null,
  };
  const onCreated = vi.fn();
  const onMoved = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>{children}</TestApiProvider>
  );
  const v = viewer();
  const hook = renderHook(
    ({ cid }: { cid: string | null }) =>
      usePinTool({ projectId: PROJECT_ID, cloudId: cid, viewer: v, onCreated, onMoved, seams }),
    { wrapper, initialProps: { cid: cloudId } },
  );
  return { ...hook, requests, seen, onCreated, onMoved };
}

const created = { ...exampleFindingDetail, id: "f-new", number: 300 };

describe("usePinTool", () => {
  beforeEach(() => {
    localStorage.clear();
    useChangesStore.setState({ findingsRevision: 0 });
  });

  it("makes a draft at the pick with the viewer's surface normal", () => {
    const { result } = setup([]);
    act(() => result.current.pick(pick(at(0, 0, 0))));
    expect(result.current.draft).toEqual({ p: at(0, 0, 0), u: 0.01, normal: UP });
  });

  it("has no normal when the picked spot projects off screen or the view is gone", () => {
    const pickWithNormal = vi.fn();
    const off = { project: () => null, pickWithNormal } as unknown as CloudViewerHandle;
    expect(normalAt(off, pick(at(0, 0, 0)))).toBeNull();
    expect(pickWithNormal).not.toHaveBeenCalled();
    expect(normalAt(null, pick(at(0, 0, 0)))).toBeNull();
  });

  it("creates with F's anchor, records the normal, then requests a create capture", async () => {
    const { result, requests, seen, onCreated } = setup([
      { method: "POST", path: /\/findings$/, status: 201, body: created },
    ]);
    act(() => result.current.pick(pick(at(0, 0, 0))));
    let id: string | null = null;
    await act(async () => {
      id = await result.current.create({ typeId: TYPE_SPALLING, severity: 3, note: "Spall" });
    });
    expect(id).toBe("f-new");
    expect(requests[0].body).toEqual({
      type_id: TYPE_SPALLING,
      anchor: {
        kind: "cloud",
        cloud_id: CLOUD_ID,
        x: at(0, 0, 0)[0],
        y: at(0, 0, 0)[1],
        z: at(0, 0, 0)[2],
        uncertainty_m: 0.01,
      },
      severity: 3,
      note: "Spall",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe("f-new");
    expect(seen[0][1]).toBe("create");
    expect(seen[0][2]).toEqual(UP); // recorded before the capture was requested (R1 reads it at once)
    expect(result.current.draft).toBeNull();
    expect(readLastType()).toBe(TYPE_SPALLING);
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f-new", number: 300, p: at(0, 0, 0), u: 0.01, normal: UP }),
    );
    expect(useChangesStore.getState().findingsRevision).toBe(1);
  });

  it("keeps the draft when the create is refused", async () => {
    const { result, seen } = setup([
      {
        method: "POST",
        path: /\/findings$/,
        status: 422,
        body: errorBody("not_a_defect", "Only defect types can hold a finding."),
      },
    ]);
    act(() => result.current.pick(pick(at(0, 0, 0))));
    await act(async () => {
      await result.current.create({ typeId: "t-object", severity: null, note: "" });
    });
    expect(result.current.draft).not.toBeNull();
    expect(seen).toHaveLength(0);
  });

  it("records the normal and requests a capture after a move", async () => {
    const { result, requests, seen, onMoved } = setup([
      { method: "PATCH", path: /\/findings\/f-9$/, body: { ...exampleFindingDetail, id: "f-9" } },
    ]);
    act(() => result.current.startMove("f-9"));
    expect(result.current.moving).toBe("f-9");
    act(() => result.current.pick(pick(at(1, 0, 0))));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(requests[0].body).toEqual({
      anchor: { x: at(1, 0, 0)[0], y: at(1, 0, 0)[1], z: at(1, 0, 0)[2], uncertainty_m: 0.01 },
    });
    expect(seen[0][0]).toBe("f-9");
    expect(seen[0][1]).toBe("move");
    expect(seen[0][2]).toEqual(UP);
    expect(onMoved).toHaveBeenCalledWith("f-9", at(1, 0, 0), 0.01, UP);
    expect(result.current.moving).toBeNull();
    expect(result.current.draft).toBeNull();
  });

  it("ignores picks while a create is in flight", async () => {
    const { result } = setup([{ method: "POST", path: /\/findings$/, status: 201, body: created }]);
    act(() => result.current.pick(pick(at(0, 0, 0))));
    let done: Promise<string | null> = Promise.resolve(null);
    act(() => {
      done = result.current.create({ typeId: TYPE_SPALLING, severity: 3, note: "" });
    });
    expect(result.current.busy).toBe(true);
    act(() => result.current.pick(pick(at(2, 0, 0))));
    expect(result.current.draft?.p).toEqual(at(0, 0, 0)); // the in-flight draft, not a new one
    await act(async () => {
      await done;
    });
    expect(result.current.busy).toBe(false);
    act(() => result.current.pick(pick(at(2, 0, 0))));
    expect(result.current.draft?.p).toEqual(at(2, 0, 0));
  });

  it("cancels a draft or a move, and says when there was nothing", () => {
    const { result } = setup([]);
    expect(result.current.cancel()).toBe(false);
    act(() => result.current.pick(pick(at(0, 0, 0))));
    let cancelled = false;
    act(() => {
      cancelled = result.current.cancel();
    });
    expect(cancelled).toBe(true);
    expect(result.current.draft).toBeNull();
  });

  it("says stop arming after cancelling a pending move, since it started from Orbit", () => {
    const { result } = setup([]);
    act(() => result.current.startMove("f-9"));
    let cancelled = true;
    act(() => {
      cancelled = result.current.cancel();
    });
    expect(cancelled).toBe(false);
    expect(result.current.moving).toBeNull();
  });

  it("drops the draft when the cloud changes", () => {
    const { result, rerender } = setup([]);
    act(() => result.current.pick(pick(at(0, 0, 0))));
    rerender({ cid: "c-other" });
    expect(result.current.draft).toBeNull();
  });

  it("reads and survives a broken last-type store", () => {
    localStorage.setItem(LAST_TYPE_KEY, TYPE_SPALLING);
    expect(readLastType()).toBe(TYPE_SPALLING);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLastType()).toBeNull();
    get.mockRestore();
  });
});
