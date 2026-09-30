import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Job } from "@contract/client";
import { useJobsStore } from "@/store/jobs";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import {
  INSPECT_JOB_ID,
  LAS,
  LIBRARY_UP,
  THERMAL,
  VERTICAL,
  VISUAL,
  doneInspectJob,
  draftBucket,
  inspectJob,
  inspectResult,
} from "@/test/setupFixtures";
import { reportedInline } from "@/ui";
import { useSetupDraft } from "./draftStore";
import { useInspect } from "./useInspect";

/** What `GET /library/jobs/{id}` answers next. */
let current: Job;

function mount(extra: FakeRoute[] = []) {
  const { api, requests } = fakeClient([
    ...extra,
    { method: "GET", path: /\/library\/status$/, body: LIBRARY_UP },
    { method: "POST", path: /\/setup\/inspect$/, status: 202, body: { job: inspectJob() } },
    {
      method: "POST",
      path: /\/library\/jobs\/[^/]+\/cancel$/,
      body: () => ({ ...current, state: "cancelled" }),
    },
    { method: "GET", path: /\/library\/jobs\/[^/]+$/, body: () => current },
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>{children}</TestApiProvider>
  );
  return { requests, ...renderHook(() => useInspect(), { wrapper }) };
}

describe("useInspect", () => {
  beforeEach(() => {
    useSetupDraft.getState().discard();
    useJobsStore.setState({ jobs: {} });
    current = inspectJob();
  });

  it("starts a sort on the library with the chosen template, then sorts the result into its slots", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    current = doneInspectJob(inspectResult([VISUAL, THERMAL]));
    const { result, requests } = mount();
    await act(() => result.current.start(["E:\\DCIM"]));
    expect(requests.find((r) => r.url === "/api/v1/setup/inspect")?.body).toEqual({
      paths: ["E:\\DCIM"],
      template_id: "builtin-vertical",
    });
    await waitFor(() =>
      expect(useSetupDraft.getState().buckets.map((b) => b.slot_key)).toEqual(["visual", "thermal"]),
    );
    expect(useSetupDraft.getState().inspect).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it("leaving mid-sort and coming back applies the result once", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    const first = mount();
    await act(() => first.result.current.start(["E:\\DCIM"]));
    await waitFor(() => expect(first.result.current.job?.state).toBe("running"));
    expect(first.result.current.running).toBe(true);
    first.unmount();

    current = doneInspectJob(
      inspectResult([VISUAL, THERMAL], {
        not_recognised: {
          count: 2,
          samples: [
            { name: "Thumbs.db", reason: "unknown type" },
            { name: "notes.txt", reason: "unknown type" },
          ],
        },
      }),
    );
    const second = mount();
    await waitFor(() => expect(useSetupDraft.getState().buckets).toHaveLength(2));
    await waitFor(() => expect(second.result.current.running).toBe(false));
    // Applied exactly once: a second application would add the not-recognised count again.
    expect(useSetupDraft.getState().notRecognised.count).toBe(2);
  });

  it("a failed sort says why and keeps the earlier buckets", async () => {
    useSetupDraft.getState().setBuckets([draftBucket(LAS)]);
    current = inspectJob({
      state: "failed",
      error: "E:\\DCIM could not be read",
      finished_at: "2026-09-30T10:01:00Z",
    });
    const { result } = mount();
    await act(() => result.current.start(["E:\\DCIM"]));
    await waitFor(() => expect(result.current.error).toBe("E:\\DCIM could not be read"));
    expect(useSetupDraft.getState().buckets).toHaveLength(1);
    act(() => result.current.dismissError());
    expect(result.current.error).toBeNull();
  });

  it("Cancel stops the job and returns to the empty state", async () => {
    const { result, requests } = mount();
    await act(() => result.current.start(["E:\\DCIM"]));
    expect(result.current.running).toBe(true);
    await act(() => result.current.cancel());
    expect(
      requests.some((r) => r.method === "POST" && r.url === `/api/v1/library/jobs/${INSPECT_JOB_ID}/cancel`),
    ).toBe(true);
    expect(result.current.running).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("says the library is unavailable, from its status or from a refused start (S-R3)", async () => {
    const down = mount([
      {
        method: "GET",
        path: /\/library\/status$/,
        body: { ...LIBRARY_UP, available: false, error: "library.db is corrupt" },
      },
    ]);
    await waitFor(() => expect(down.result.current.libraryUnavailable).toBe("library.db is corrupt"));
    down.unmount();

    const refused = mount([
      {
        method: "POST",
        path: /\/setup\/inspect$/,
        status: 503,
        body: errorBody("library_unavailable", "the library could not be opened"),
      },
    ]);
    await act(() => refused.result.current.start(["E:\\DCIM"]));
    expect(refused.result.current.libraryUnavailable).toBe("the library could not be opened");
    expect(refused.result.current.error).toBeNull();
  });

  it("owns the sort's outcome while mounted, so the global toast stays quiet", async () => {
    const { result, unmount } = mount();
    await act(() => result.current.start(["E:\\DCIM"]));
    // Off the setup route only the claim keeps the toast quiet (on it, `REPORTED_ON` already does).
    expect(reportedInline(inspectJob(), "/projects")).toBe(true);
    unmount();
    expect(reportedInline(inspectJob(), "/projects")).toBe(false);
  });

  it("sends at most 16 paths and drops blanks", async () => {
    const { result, requests } = mount();
    await act(() => result.current.start(["", ...Array.from({ length: 20 }, (_, i) => `E:\\F${i}`)]));
    const body = requests.find((r) => r.url === "/api/v1/setup/inspect")?.body as { paths: string[] };
    expect(body.paths).toHaveLength(16);
    expect(body.paths[0]).toBe("E:\\F0");
  });
});
