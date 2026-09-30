import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ApiClient, Job } from "@contract/client";
import { exampleJob, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import {
  useReportActions,
  useReportAssetSrc,
  useReportOutline,
  useReports,
  useReportVersions,
  useSnapshotSrc,
  type SnapshotRef,
} from "./reports";

const wrap = (api: ApiClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <TestApiProvider api={api}>{children}</TestApiProvider>;
  };

beforeEach(() => useJobsStore.setState({ jobs: {} }));

describe("useReports", () => {
  it("loads one page, appends the next on loadMore, dedupes, and stops on a repeated cursor", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/reports$/,
        body: (r) =>
          r.url.includes("cursor=c2")
            ? { items: [{ id: "b" }, { id: "c" }], next_cursor: "c2" }
            : { items: [{ id: "a" }, { id: "b" }], next_cursor: "c2" },
      },
    ]);
    const { result } = renderHook(() => useReports("p1"), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((r) => r.id)).toEqual(["a", "b", "c"]));
    expect(result.current.hasMore).toBe(false);
    expect(requests).toHaveLength(2);
  });

  it("reports an error message instead of throwing", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/reports$/,
        status: 500,
        body: { error: { code: "boom", message: "disk", details: {} } },
      },
    ]);
    const { result } = renderHook(() => useReports("p1"), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.error).toBe("disk"));
    expect(result.current.items).toEqual([]);
  });
});

describe("useReportOutline", () => {
  it("keeps the previous outline while a reload is in flight", async () => {
    let n = 0;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/outline$/,
        body: () => ({ sections: [], finding_count: ++n, warnings: [] }),
      },
    ]);
    const { result } = renderHook(() => useReportOutline("p1", "r1"), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.outline?.finding_count).toBe(1));
    act(() => result.current.reload());
    expect(result.current.outline?.finding_count).toBe(1);
    expect(result.current.refreshing).toBe(true);
    await waitFor(() => expect(result.current.outline?.finding_count).toBe(2));
    expect(result.current.refreshing).toBe(false);
  });
});

describe("useReportVersions", () => {
  it("reloads when a report_render job ends", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/versions$/, body: { items: [], next_cursor: null } },
    ]);
    const { result } = renderHook(() => useReportVersions("p1", "r1"), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const job: Job = { ...exampleJob, id: "rj1", type: "report_render", state: "running" };
    act(() => useJobsStore.getState().upsert(job));
    act(() => useJobsStore.getState().upsert({ ...job, state: "succeeded" }));
    await waitFor(() => expect(requests.filter((r) => r.url.includes("/versions"))).toHaveLength(2));
  });
});

describe("useReportActions", () => {
  it("hands a started render to the jobs store", async () => {
    const job: Job = { ...exampleJob, id: "rj2", type: "report_render", state: "queued" };
    const { api } = fakeClient([{ method: "POST", path: /\/renders$/, status: 202, body: { job } }]);
    const { result } = renderHook(() => useReportActions("p1"), { wrapper: wrap(api) });
    await act(async () => {
      await result.current.render("r1", { formats: ["pdf"] });
    });
    expect(useJobsStore.getState().jobs.rj2?.type).toBe("report_render");
  });

  it("memoises blocksLoader by reportId, but never reuses a loader across a projectId change", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/sections\/summary\/blocks$/, body: { items: [], next_cursor: null } },
    ]);
    // `blocksLoader` is called synchronously during render here, the way a host builds a `loadBlocks`
    // prop inline in JSX (`loadBlocks={actions.blocksLoader(reportId)}`) — a `useEffect`-based cache
    // reset would not have run yet at this point in the same render pass that changed `projectId`, so
    // this is the shape that actually exercises the staleness the cache must avoid.
    const { result, rerender } = renderHook(
      ({ projectId }) => useReportActions(projectId).blocksLoader("r1"),
      { wrapper: wrap(api), initialProps: { projectId: "p1" } },
    );
    const loaderA = result.current;

    rerender({ projectId: "p1" });
    expect(result.current).toBe(loaderA);

    rerender({ projectId: "p2" });
    const loaderB = result.current;
    expect(loaderB).not.toBe(loaderA);

    await loaderB("summary", null);
    expect(requests.at(-1)?.url).toBe("/api/v1/projects/p2/reports/r1/sections/summary/blocks?limit=50");
  });

  it("memoises versionLoader by reportId and n, but never reuses a loader across an api change", async () => {
    const clientA = fakeClient([{ method: "GET", path: /\/versions\/2\/document$/, body: { items: [] } }]);
    const clientB = fakeClient([
      {
        method: "GET",
        path: /\/versions\/2\/document$/,
        body: {
          report_id: "r1",
          version: 2,
          generated_at: "x",
          theme_version: "v1",
          sections: [],
          next_cursor: null,
        },
      },
    ]);
    // The `wrapper` component isn't re-invoked with new props by `rerender` (it only ever receives
    // `children`), so the swap is done through a variable the Wrapper closure reads fresh each render.
    let activeApi = clientA.api;
    function Wrapper({ children }: { children: ReactNode }) {
      return <TestApiProvider api={activeApi}>{children}</TestApiProvider>;
    }
    // `versionLoader` is likewise called synchronously during render, not from the test body after
    // `rerender()` returns (act() would already have flushed any reset effect by then).
    const { result, rerender } = renderHook(() => useReportActions("p1").versionLoader("r1", 2), {
      wrapper: Wrapper,
    });
    const loaderA = result.current;

    activeApi = clientB.api;
    rerender();
    const loaderB = result.current;
    expect(loaderB).not.toBe(loaderA);

    await loaderB("summary", null);
    expect(clientB.requests).toHaveLength(1);
    expect(clientA.requests).toHaveLength(0);
  });
});

describe("useSnapshotSrc", () => {
  const ref = { key: "k1", spec: { kind: "volume_plan", measurement_id: "m1" } } as unknown as SnapshotRef;

  it("points at the backend with the token", () => {
    const { api } = fakeClient([]);
    const { result } = renderHook(() => useSnapshotSrc("p1"), { wrapper: wrap(api) });
    expect(result.current(ref)).toMatch(
      /^http:\/\/fake\/api\/v1\/projects\/p1\/report-snapshots\/k1\?spec=[A-Za-z0-9_-]+&token=t$/,
    );
  });

  it("returns null without a backend (gallery)", () => {
    const { result } = renderHook(() => useSnapshotSrc("p1"));
    expect(result.current(ref)).toBeNull();
  });
});

describe("useReportAssetSrc", () => {
  it("points at the backend with the token", () => {
    const { api } = fakeClient([]);
    const { result } = renderHook(() => useReportAssetSrc("p1"), { wrapper: wrap(api) });
    expect(result.current("asset1")).toBe("http://fake/api/v1/projects/p1/report-assets/asset1?token=t");
  });

  it("returns null without a backend (gallery)", () => {
    const { result } = renderHook(() => useReportAssetSrc("p1"));
    expect(result.current("asset1")).toBeNull();
  });
});
