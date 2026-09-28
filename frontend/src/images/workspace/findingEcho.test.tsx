import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback, useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { AppEvent, Box } from "@contract/client";
import { ANNOTATION_ID, exampleFinding, FINDING_ID_2, typedProject } from "@/test/findingFixtures";
import { fakeClient, IMAGE_ID, personBox, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { EMPTY_LEDGER } from "@/store/changesEcho";
import { setFindingSeverity } from "@/images/ai/review";
import { useInspectorModel } from "./useInspectorModel";

/**
 * Programme ruling R8: FA's `setFindingSeverity` must route its write through the own-write echo
 * dedupe (`ownFindingsWrite`), so a severity edit re-reads this workspace's `/findings?image_id=`
 * page exactly once — not twice (once for the client's own bump, once more for the server's
 * `findings.changed` echo of that same write).
 */
const defect = { ...personBox, id: ANNOTATION_ID } as Box;
const boxes: Record<string, Box> = { [ANNOTATION_ID]: defect };

const links: Record<string, string> = {};
vi.mock("./seams", () => ({
  useSelection: () => ({ selectedId: ANNOTATION_ID, select: vi.fn(), boxes, boxesLoaded: true }),
  // Reactive double (inspectorState.test.tsx's pattern): a real Zustand `findingOf` selector hands
  // back a new object once `linkFindings` sets new state, which is what re-triggers
  // useInspectorModel's effects; this reproduces that with its own state.
  useFindingLinks: () => {
    const [current, setCurrent] = useState<Record<string, string>>(() => ({ ...links }));
    const linkFindings = useCallback((l: Record<string, string>) => {
      Object.assign(links, l);
      setCurrent((prev) => (Object.entries(l).every(([k, v]) => prev[k] === v) ? prev : { ...prev, ...l }));
    }, []);
    return { findingOf: current, linkFindings };
  },
}));

const echo = (ids: string[]): AppEvent => ({
  type: "findings.changed",
  project_id: PROJECT_ID,
  job_id: null,
  progress: null,
  message: "",
  payload: { ids },
});

function findingsReads(requests: { url: string; method: string }[]): number {
  return requests.filter((r) => r.method === "GET" && r.url.includes("/findings?image_id=")).length;
}

function mountInspector() {
  const severity = { current: exampleFinding.severity };
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: typedProject },
    {
      method: "GET",
      path: /\/findings$/,
      body: () => ({ items: [{ ...exampleFinding, severity: severity.current }], next_cursor: null }),
    },
    {
      method: "PATCH",
      path: /\/findings\/[^/]+$/,
      body: (r) => {
        severity.current = (r.body as { severity: number }).severity;
        return { ...exampleFinding, severity: severity.current };
      },
    },
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>
      <MemoryRouter>{children}</MemoryRouter>
    </TestApiProvider>
  );
  const { result } = renderHook(() => useInspectorModel(PROJECT_ID, IMAGE_ID), { wrapper });
  return { api, requests, result };
}

describe("findings-on-image re-reads after a severity edit (rulings R8)", () => {
  beforeEach(() => {
    Object.keys(links).forEach((k) => delete links[k]);
    useChangesStore.setState({ findingsRevision: 0, findingEchoes: EMPTY_LEDGER, openProjectId: null });
  });

  it("one edit, delivered as the client's own echo, re-reads the page exactly once", async () => {
    const { api, requests, result } = mountInspector();
    await waitFor(() => expect(findingsReads(requests)).toBe(1));

    await act(async () => {
      await setFindingSeverity(api, PROJECT_ID, exampleFinding.id, 3);
    });
    act(() => useChangesStore.getState().applyEvent(echo([exampleFinding.id])));

    await waitFor(() => expect(result.current.findings[0]?.severity).toBe(3));
    // Flush any further effects a second, unwanted re-read would have queued.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(findingsReads(requests)).toBe(2); // 1 on mount + exactly 1 for the edit
  });

  it("a findings.changed for a finding this client did not write still re-reads exactly once", async () => {
    const { requests } = mountInspector();
    await waitFor(() => expect(findingsReads(requests)).toBe(1));

    act(() => useChangesStore.getState().applyEvent(echo([FINDING_ID_2])));

    await waitFor(() => expect(findingsReads(requests)).toBe(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(findingsReads(requests)).toBe(2);
  });
});
