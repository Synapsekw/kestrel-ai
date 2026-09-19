import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  exampleModel,
  exampleProject,
  errorBody,
  fakeClient,
  PROJECT_ID,
  CLASS_ID,
  SOURCE_ID,
  runningJob,
  exampleStats,
} from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { fetchModels, patchProject, saveClasses, useGroups, useProject, useSourceNames } from "./project";

describe("project api", () => {
  it("saves classes with PUT and patches the project", async () => {
    const { api, requests } = fakeClient([
      { method: "PUT", path: /\/classes$/, body: exampleProject },
      { method: "PATCH", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
    ]);
    await saveClasses(api, PROJECT_ID, [{ id: CLASS_ID(1), name: "digger", colour: "#ffffff", hotkey: "1" }]);
    await patchProject(api, PROJECT_ID, { preannotation_model_id: null });
    expect((await fetchModels(api, PROJECT_ID))[0].name).toBe("yolo11m-coco");
    expect(requests[0]).toMatchObject({ method: "PUT", url: `/api/v1/projects/${PROJECT_ID}/classes` });
    expect(requests[0].body).toEqual([{ id: CLASS_ID(1), name: "digger", colour: "#ffffff", hotkey: "1" }]);
    expect(requests[1]).toMatchObject({ method: "PATCH", body: { preannotation_model_id: null } });
  });

  it("useProject loads the project; useSourceNames tolerates 501 and maps ids to sites", async () => {
    const stub = fakeClient([
      { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
      { method: "GET", path: /\/sources$/, status: 501, body: errorBody("not_implemented", "S1 later") },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={stub.api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useProject(PROJECT_ID), { wrapper });
    await waitFor(() => expect(result.current.project?.name).toBe("Ahmadia"));
    const names = renderHook(() => useSourceNames(PROJECT_ID), { wrapper });
    await waitFor(() => expect(stub.requests.some((r) => r.url.endsWith("/sources"))).toBe(true));
    expect(names.result.current).toEqual({});

    const ok = fakeClient([
      {
        method: "GET",
        path: /\/sources$/,
        body: {
          items: [
            {
              id: SOURCE_ID,
              folder: "E:\\data",
              site: "ahmadia",
              settings: exampleProject.import_defaults,
              image_count: 1,
              duplicate_count: 0,
              job_id: null,
              imported_at: null,
              created_at: "2026-09-17T10:05:00Z",
            },
          ],
          next_cursor: null,
        },
      },
    ]);
    const wrapper2 = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={ok.api}>{children}</TestApiProvider>
    );
    const names2 = renderHook(() => useSourceNames(PROJECT_ID), { wrapper: wrapper2 });
    await waitFor(() => expect(names2.result.current).toEqual({ [SOURCE_ID]: "ahmadia" }));

    // A finished import brings a new source: the names are fetched again without leaving the screen.
    const before = ok.requests.filter((r) => r.url.endsWith("/sources")).length;
    act(() => useJobsStore.getState().upsert({ ...runningJob, type: "import" }));
    act(() => useJobsStore.getState().upsert({ ...runningJob, type: "import", state: "succeeded" }));
    await waitFor(() =>
      expect(ok.requests.filter((r) => r.url.endsWith("/sources")).length).toBe(before + 1),
    );
  });

  it("useGroups lists the project's groups from the stats and is empty when they cannot be loaded", async () => {
    const ok = fakeClient([{ method: "GET", path: /\/stats$/, body: exampleStats }]);
    const groups = renderHook(() => useGroups(PROJECT_ID), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <TestApiProvider api={ok.api}>{children}</TestApiProvider>
      ),
    });
    await waitFor(() => expect(groups.result.current).toEqual(exampleStats.groups));

    const broken = fakeClient([
      { method: "GET", path: /\/stats$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    const none = renderHook(() => useGroups(PROJECT_ID), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <TestApiProvider api={broken.api}>{children}</TestApiProvider>
      ),
    });
    await waitFor(() => expect(broken.requests.length).toBe(1));
    expect(none.result.current).toEqual([]);
  });
});
