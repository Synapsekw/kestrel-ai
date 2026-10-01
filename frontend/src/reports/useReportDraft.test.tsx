import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "@contract/client";
import {
  errorBody,
  fakeClient,
  fakeFetch,
  PROJECT_ID,
  type FakeRoute,
  type RecordedRequest,
} from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { outline, report, REPORT_ID } from "@/test/reportBuilderFixtures";
import { useChangesStore } from "@/store/changes";
import type { ReportConfig } from "@/api/reports";
import { setSectionEnabled } from "./builderModel";
import { useReportDraft } from "./useReportDraft";

const patches = (rq: RecordedRequest[]) => rq.filter((r) => r.method === "PATCH");
const outlines = (rq: RecordedRequest[]) => rq.filter((r) => r.method === "GET" && /\/outline$/.test(r.url));

function routes(patchStatus = 200): FakeRoute[] {
  return [
    { method: "GET", path: /\/reports\/[^/]+\/outline$/, body: outline() },
    {
      method: "PATCH",
      path: /\/reports\/[^/]+$/,
      status: patchStatus,
      body: (r) =>
        patchStatus === 200
          ? { ...report(), ...(r.body as object) }
          : errorBody("invalid_report", "The report is not valid", {
              errors: [{ path: "config.filters.date.days", message: "must be at least 1" }],
            }),
    },
    { method: "GET", path: /\/reports\/[^/]+$/, body: report() },
  ];
}

function setup(rs: FakeRoute[] = routes(), client = fakeClient(rs)) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={client.api}>{children}</TestApiProvider>
  );
  const hook = renderHook(() => useReportDraft(PROJECT_ID, REPORT_ID), { wrapper });
  return { ...hook, requests: client.requests };
}

const disable = (key: "appendix" | "summary") => (c: ReportConfig) => ({
  ...c,
  sections: setSectionEnabled(c.sections, key, false),
});

describe("useReportDraft", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0 }));
  afterEach(() => vi.useRealTimers());

  it("loads the report and its outline", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.title).toBe("Site inspection September");
    await waitFor(() => expect(result.current.outline?.finding_count).toBe(38));
  });

  it("debounces edits 400 ms and sends the whole config once", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    vi.useFakeTimers();
    act(() => result.current.edit(disable("appendix")));
    act(() => result.current.edit(disable("summary")));
    expect(result.current.saveState).toBe("pending");
    await act(() => vi.advanceTimersByTimeAsync(399));
    expect(patches(requests)).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(1));
    vi.useRealTimers();
    await waitFor(() => expect(patches(requests)).toHaveLength(1));
    const body = patches(requests)[0].body as {
      title: string;
      config: { sections: { key: string; enabled: boolean }[] };
    };
    expect(body.title).toBe("Site inspection September");
    expect(body.config.sections).toHaveLength(8);
    expect(body.config.sections.filter((s) => !s.enabled).map((s) => s.key)).toEqual([
      "summary",
      "comparison",
      "object_counts",
      "appendix",
    ]);
    await waitFor(() => expect(outlines(requests)).toHaveLength(2));
    await waitFor(() => expect(result.current.saveState).toBe("saved"));
  });

  it("a refused save keeps the edit and names the field", async () => {
    const { result } = setup(routes(422));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.edit(disable("appendix")));
    await waitFor(() => expect(result.current.saveState).toBe("error"));
    expect(result.current.saveError).toBe("config.filters.date.days: must be at least 1");
    expect(result.current.config?.sections.find((s) => s.key === "appendix")?.enabled).toBe(false);
  });

  it("an edit still waiting when the builder closes is saved", async () => {
    const { result, unmount, requests } = setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.edit(disable("appendix")));
    unmount();
    await waitFor(() => expect(patches(requests)).toHaveLength(1));
  });

  it("flush sends a waiting edit at once and says whether it saved", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.edit(disable("appendix")));
    let ok = false;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(patches(requests)).toHaveLength(1);
  });

  it("flush reports a refused save as false", async () => {
    const { result } = setup(routes(422));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.edit(disable("appendix")));
    let ok = true;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(false);
  });

  it("flush re-sends a save that failed, and reports success once it lands", async () => {
    let calls = 0;
    const rs = routes().map((r) =>
      r.method === "PATCH"
        ? {
            ...r,
            status: () => (++calls === 1 ? 500 : 200),
            body: (req: RecordedRequest) =>
              calls === 1
                ? errorBody("internal", "The disk is busy.")
                : { ...report(), ...(req.body as object) },
          }
        : r,
    );
    const { result, requests } = setup(rs);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.edit(disable("appendix")));
    await waitFor(() => expect(result.current.saveState).toBe("error"));
    expect(result.current.saveErrorCode).toBe("internal");
    let ok = false;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(patches(requests)).toHaveLength(2);
    const body = patches(requests)[1].body as { config: { sections: { key: string; enabled: boolean }[] } };
    expect(body.config.sections.find((s) => s.key === "appendix")?.enabled).toBe(false);
    expect(result.current.saveState).toBe("saved");
    expect(result.current.saveErrorCode).toBeNull();
  });

  it("a save that failed is re-sent when the builder closes", async () => {
    let calls = 0;
    const rs = routes().map((r) =>
      r.method === "PATCH"
        ? {
            ...r,
            status: () => (++calls === 1 ? 500 : 200),
            body: (req: RecordedRequest) =>
              calls === 1 ? errorBody("internal", "boom") : { ...report(), ...(req.body as object) },
          }
        : r,
    );
    const { result, unmount, requests } = setup(rs);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.edit(disable("appendix")));
    await waitFor(() => expect(result.current.saveState).toBe("error"));
    unmount();
    await waitFor(() => expect(patches(requests)).toHaveLength(2));
  });

  it("flush does not report failure when an edit lands during the flush", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.edit(disable("appendix")));
    let ok = false;
    await act(async () => {
      const p = result.current.flush();
      result.current.edit(disable("summary"));
      ok = await p;
    });
    expect(ok).toBe(true);
    expect(patches(requests)).toHaveLength(2);
  });

  it("an empty title is kept locally and not sent", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.setTitle(""));
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.title).toBe("");
    expect(patches(requests)[0].body).not.toHaveProperty("title");
  });

  it("a findings change re-reads the outline", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(outlines(requests)).toHaveLength(1));
    expect(result.current.status).toBe("ready");
    act(() => useChangesStore.setState({ findingsRevision: 1 }));
    await waitFor(() => expect(outlines(requests)).toHaveLength(2));
  });

  it("an edit made during a save is sent after it", async () => {
    const inner = fakeFetch(routes());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
      const method = input instanceof Request ? input.method : (init?.method ?? "GET");
      const res = await inner.fetch(input, init);
      if (method === "PATCH" && !held) {
        held = true;
        await gate;
      }
      return res;
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
    const { result } = setup([], { api, requests: inner.requests });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.edit(disable("appendix")));
    await waitFor(() => expect(patches(inner.requests)).toHaveLength(1));
    act(() => result.current.edit(disable("summary")));
    await new Promise((r) => setTimeout(r, 600));
    expect(patches(inner.requests)).toHaveLength(1); // still waiting on the first
    release();
    await waitFor(() => expect(patches(inner.requests)).toHaveLength(2));
    const last = patches(inner.requests)[1].body as {
      config: { sections: { key: string; enabled: boolean }[] };
    };
    expect(last.config.sections.find((s) => s.key === "summary")?.enabled).toBe(false);
    expect(last.config.sections.find((s) => s.key === "appendix")?.enabled).toBe(false);
  });
});
