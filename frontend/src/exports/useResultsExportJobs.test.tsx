import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useResultsExportJobs } from "./useResultsExportJobs";

describe("useResultsExportJobs", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

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
});
