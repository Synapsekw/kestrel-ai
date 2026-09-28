import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CloudViewOut } from "@contract/client";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { exampleFinding } from "@/test/findingFixtures";
import { CLOUD_ID } from "@/test/cloudFixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import type { Finding } from "@/api/findings";
import { setAnchorNormal } from "@/clouds/views/normals";
import { toCloudPin, useCloudPins } from "./useCloudPins";

const cloudFinding = (id: string, x = 243500): Finding => ({
  ...exampleFinding,
  id,
  anchor: { kind: "cloud", cloud_id: CLOUD_ID, x, y: 3178000, z: 40, uncertainty_m: 0.05 },
  data_type: "point_cloud",
  data_id: CLOUD_ID,
});

const view = (id: string, n: [number, number, number] | null, stale = false): CloudViewOut =>
  ({
    subject_kind: "finding",
    subject_id: id,
    pose: { position: [0, 0, 0], target: [1, 1, 1], up: [0, 0, 1], fov_deg: 50 },
    render: {
      colour_mode: "rgb",
      point_budget: 3_000_000,
      point_size: 1,
      edl: true,
      clip_box: null,
      complete: true,
    },
    anchor_normal: n,
    sha256: "ab".repeat(32),
    bytes: 1,
    width: 1600,
    height: 1000,
    captured_at: "2026-09-27T10:00:00Z",
    stale,
  }) as CloudViewOut;

function setup(routes: FakeRoute[]) {
  const { api, requests } = fakeClient(routes);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>{children}</TestApiProvider>
  );
  return { requests, wrapper };
}

// fakeFetch's route `path` regex matches the URL pathname only (no query string; dispatch-common).
const findingsRoute = (items: Finding[]): FakeRoute => ({
  method: "GET",
  path: /\/findings$/,
  body: { items, next_cursor: null },
});
const viewsRoute = (items: CloudViewOut[]): FakeRoute => ({
  method: "GET",
  path: /\/pointclouds\/[^/]+\/views$/,
  body: { items },
});

describe("useCloudPins", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, pointcloudsRevision: 0 }));

  it("merges the listed view normals into the pins", async () => {
    const { wrapper } = setup([
      findingsRoute([cloudFinding("f-a"), cloudFinding("f-b")]),
      viewsRoute([view("f-a", [0, -1, 0])]),
    ]);
    const { result } = renderHook(() => useCloudPins(PROJECT_ID, CLOUD_ID), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.pins.map((p) => [p.id, p.normal])).toEqual([
      ["f-a", [0, -1, 0]],
      ["f-b", null],
    ]);
    expect(result.current.pins[0].p).toEqual([243500, 3178000, 40]);
    expect(result.current.capNote).toBeNull();
  });

  it("prefers the normal recorded at pick time over the listed view", async () => {
    setAnchorNormal("f-moved", [1, 0, 0]);
    const { wrapper } = setup([
      findingsRoute([cloudFinding("f-moved")]),
      viewsRoute([view("f-moved", [0, -1, 0])]),
    ]);
    const { result } = renderHook(() => useCloudPins(PROJECT_ID, CLOUD_ID), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.pins[0].normal).toEqual([1, 0, 0]);
  });

  it("still shows the pins when the views list fails", async () => {
    const { wrapper } = setup([
      findingsRoute([cloudFinding("f-a")]),
      { method: "GET", path: /\/views$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    const { result } = renderHook(() => useCloudPins(PROJECT_ID, CLOUD_ID), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.pins).toHaveLength(1);
    expect(result.current.pins[0].normal).toBeNull();
  });

  it("skips findings whose anchor is not on a cloud", async () => {
    const { wrapper } = setup([findingsRoute([cloudFinding("f-a"), exampleFinding]), viewsRoute([])]);
    const { result } = renderHook(() => useCloudPins(PROJECT_ID, CLOUD_ID), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.pins.map((p) => p.id)).toEqual(["f-a"]);
  });

  it("refetches once per burst of findings.changed and pointclouds.changed", async () => {
    const { wrapper, requests } = setup([findingsRoute([cloudFinding("f-a")]), viewsRoute([])]);
    const { result } = renderHook(() => useCloudPins(PROJECT_ID, CLOUD_ID), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const before = requests.length;
    act(() => {
      useChangesStore.setState({ findingsRevision: 1 });
      useChangesStore.setState({ findingsRevision: 2, pointcloudsRevision: 1 });
    });
    await waitFor(() => expect(requests.length).toBe(before + 2), { timeout: 2000 });
    expect(
      requests.slice(before).map((r) => new URL(r.url, "http://fake").pathname.split("/").pop()),
    ).toEqual(expect.arrayContaining(["findings", "views"]));
  });

  it("is empty and idle without a cloud", () => {
    const { wrapper, requests } = setup([]);
    const { result } = renderHook(() => useCloudPins(PROJECT_ID, null), { wrapper });
    expect(result.current.pins).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  // Ruling T3-2: a stale listed view's normal is never used; only a fresh `getAnchorNormal` counts.
  it("ignores a stale listed view's normal when nothing was recorded at pick time", () => {
    expect(toCloudPin(cloudFinding("f-stale"), view("f-stale", [0, -1, 0], true))?.normal).toBeNull();
  });
});
