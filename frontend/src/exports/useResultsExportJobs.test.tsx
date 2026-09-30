import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "@contract/client";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useResultsExportJobs } from "./useResultsExportJobs";

describe("useResultsExportJobs", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("surfaces a finished map export in the same list as results exports, with its folder", async () => {
    const mapExport = {
      ...runningJob,
      id: "map-export-1",
      type: "map_export" as const,
      state: "succeeded" as const,
      result: { folder: "exports/2026-09-22_120000", files: ["map-a-labels.csv"], box_count: 1 },
    };
    // The list endpoint's `type` filter takes one value at a time, so the hook fires one request per
    // kind; both land on the same path, so the fake route answers from the query string.
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/jobs$/,
        body: (req) =>
          req.url.includes("type=map_export")
            ? { items: [mapExport], next_cursor: null }
            : { items: [], next_cursor: null },
      },
    ]);
    const { result } = renderHook(() => useResultsExportJobs(PROJECT_ID), {
      wrapper: ({ children }) => <TestApiProvider api={api}>{children}</TestApiProvider>,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.jobs.map((j) => j.id)).toEqual(["map-export-1"]);
  });

  it("keeps the resolved kind's jobs when the other kind's request fails", async () => {
    const resultsExportJob = {
      ...runningJob,
      id: "results-export-1",
      type: "results_export" as const,
      state: "succeeded" as const,
      result: { folder: "exports/x", files: ["a.csv"], image_count: 1, box_count: 1 },
    };
    // `fakeClient`'s route matcher only inspects the pathname, so it cannot answer the two `/jobs`
    // requests with two different HTTP statuses; a hand-rolled `fetch` keyed on the `type` query
    // param can, which is what this test needs to make one request actually reject.
    const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.searchParams.get("type") === "map_export") {
        return new Response(
          JSON.stringify({ error: { code: "http_error", message: "map export list failed", details: {} } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ items: [resultsExportJob], next_cursor: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
    const { result } = renderHook(() => useResultsExportJobs(PROJECT_ID), {
      wrapper: ({ children }) => <TestApiProvider api={api}>{children}</TestApiProvider>,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    // The results-export job that DID load must still be there...
    expect(result.current.jobs.map((j) => j.id)).toEqual(["results-export-1"]);
    // ...and the error names which kind failed, not a blanket "could not load past exports".
    expect(result.current.error).toMatch(/map exports/);
  });

  it("lists this project's volume and point cloud exports too, and never another project's", async () => {
    const volumeExport = {
      ...runningJob,
      id: "volume-export-1",
      type: "volume_export" as const,
      state: "succeeded" as const,
      created_at: "2026-09-20T10:00:00Z",
      result: { folder: "exports/2026-09-20_100000", files: ["volumes.pdf"] },
    };
    const cloudExport = {
      ...runningJob,
      id: "cloud-export-1",
      type: "pointcloud_export" as const,
      state: "succeeded" as const,
      created_at: "2026-09-21T10:00:00Z",
      result: { cloud_id: "c1", folder: "exports/2026-09-21_100000", laz: "c.laz", files: ["c.laz"], point_count: 5 },
    };
    useJobsStore.getState().upsert({ ...volumeExport, id: "other-project", project_id: "some-other-project-id" });
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/jobs$/,
        body: (req) =>
          req.url.includes("type=volume_export")
            ? { items: [volumeExport], next_cursor: null }
            : req.url.includes("type=pointcloud_export")
              ? { items: [cloudExport], next_cursor: null }
              : { items: [], next_cursor: null },
      },
    ]);
    const { result } = renderHook(() => useResultsExportJobs(PROJECT_ID), {
      wrapper: ({ children }) => <TestApiProvider api={api}>{children}</TestApiProvider>,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.jobs.map((j) => j.id)).toEqual(["cloud-export-1", "volume-export-1"]);
    const types = requests.map((r) => new URL(r.url, "http://x").searchParams.get("type")).sort();
    expect(types).toEqual(["detect_export", "map_export", "pointcloud_export", "results_export", "volume_export"]);
  });

  it("names the point cloud exports when only their request fails", async () => {
    const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (url.searchParams.get("type") === "pointcloud_export") {
        return new Response(
          JSON.stringify({ error: { code: "http_error", message: "nope", details: {} } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ items: [], next_cursor: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
    const { result } = renderHook(() => useResultsExportJobs(PROJECT_ID), {
      wrapper: ({ children }) => <TestApiProvider api={api}>{children}</TestApiProvider>,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("could not load past point cloud exports");
  });
});
