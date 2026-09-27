import { beforeEach, describe, expect, it } from "vitest";
import { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import type { AppEvent } from "@contract/client";
import type { FindingPatch } from "@/api/findings";
import { useProjectCounts } from "@/app/useProjectCounts";
import { EMPTY_LEDGER } from "@/store/changesEcho";
import { useChangesStore } from "@/store/changes";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute, type RecordedRequest } from "@/test/fixtures";
import {
  exampleActivity,
  exampleFinding,
  exampleFindingDetail,
  exampleSummary,
  FINDING_ID,
  FINDING_ID_2,
  fullOverview,
} from "@/test/findingFixtures";
import { TestApiProvider } from "@/test/render";
import { DEFAULT_FILTERS } from "./filters";
import { History } from "./inspector/History";
import { useFinding } from "./inspector/useFinding";
import { useFindingsList } from "./useFindingsList";
import { useFindingSummary } from "./useFindingSummary";

/**
 * Rulings R8: one finding edit used to re-read every mounted findings view twice (the client's own
 * bump plus the `findings.changed` echo of the same write) — up to ~10 reads. It now re-reads each
 * view once, and the edited finding's detail not at all (the PATCH answer is already applied).
 */
const detail = { ...exampleFindingDetail, id: FINDING_ID };
const DETAIL = new RegExp(`/findings/${FINDING_ID}$`);
const READS = {
  detail: DETAIL,
  list: /\/findings$/,
  summary: /\/findings\/summary$/,
  activity: /\/activity$/,
  overview: /\/overview$/,
} as const;
type Reads = Record<keyof typeof READS, number>;

function reads(requests: RecordedRequest[]): Reads {
  const out: Reads = { detail: 0, list: 0, summary: 0, activity: 0, overview: 0 };
  for (const r of requests) {
    if (r.method !== "GET") continue;
    const path = r.url.split("?")[0];
    for (const k of Object.keys(READS) as (keyof typeof READS)[]) if (READS[k].test(path)) out[k] += 1;
  }
  return out;
}

const echo = (ids: string[]): AppEvent => ({
  type: "findings.changed",
  project_id: PROJECT_ID,
  job_id: null,
  progress: null,
  message: "",
  payload: { ids },
});

function routes(opts: { echoBeforeAnswer?: boolean; refuse?: boolean } = {}): FakeRoute[] {
  return [
    { method: "GET", path: /\/findings\/summary$/, body: exampleSummary },
    { method: "GET", path: DETAIL, body: detail },
    {
      method: "PATCH",
      path: DETAIL,
      status: opts.refuse ? 409 : 200,
      body: (r) => {
        if (opts.refuse) return errorBody("invalid_transition", "closed");
        if (opts.echoBeforeAnswer) useChangesStore.getState().applyEvent(echo([FINDING_ID]));
        return { ...detail, ...(r.body as object) };
      },
    },
    { method: "GET", path: /\/findings$/, body: { items: [exampleFinding], next_cursor: null } },
    { method: "GET", path: /\/activity$/, body: { items: exampleActivity, next_cursor: null } },
    { method: "GET", path: /\/overview$/, body: fullOverview },
  ];
}

const live: { update: ((p: FindingPatch) => Promise<void>) | null } = { update: null };

/** What the Findings tab mounts around one selected finding. */
function FindingsViews() {
  const { update } = useFinding(PROJECT_ID, FINDING_ID);
  useFindingsList(PROJECT_ID, DEFAULT_FILTERS);
  useFindingSummary(PROJECT_ID);
  useProjectCounts(PROJECT_ID);
  useEffect(() => {
    live.update = update;
  });
  return <History projectId={PROJECT_ID} findingId={FINDING_ID} />;
}

/** Past useFindingsList's 300 ms debounce. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });

async function mount(opts?: Parameters<typeof routes>[0]) {
  const { api, requests } = fakeClient(routes(opts));
  render(
    <TestApiProvider api={api}>
      <FindingsViews />
    </TestApiProvider>,
  );
  await waitFor(() =>
    expect(reads(requests)).toEqual({ detail: 1, list: 1, summary: 1, activity: 1, overview: 1 }),
  );
  await settle();
  return requests;
}

describe("one finding edit re-reads each findings view once (rulings R8)", () => {
  beforeEach(() => {
    live.update = null;
    useChangesStore.setState({
      findingsRevision: 0,
      dataRevision: 0,
      findingEchoes: EMPTY_LEDGER,
      openProjectId: null,
    });
  });

  it("one edit re-reads each view once, and its own detail not at all", async () => {
    const requests = await mount();
    await act(async () => {
      await live.update!({ severity: 3 });
    });
    act(() => useChangesStore.getState().applyEvent(echo([FINDING_ID])));
    await settle();
    expect(reads(requests)).toEqual({ detail: 1, list: 2, summary: 2, activity: 2, overview: 2 });
    expect(useChangesStore.getState().findingsRevision).toBe(1);
  });

  it("the echo arriving before the answer is still one re-read", async () => {
    const requests = await mount({ echoBeforeAnswer: true });
    await act(async () => {
      await live.update!({ severity: 3 });
    });
    await settle();
    expect(reads(requests)).toEqual({ detail: 1, list: 2, summary: 2, activity: 2, overview: 2 });
  });

  it("a change made elsewhere still re-reads everything, the detail included", async () => {
    const requests = await mount();
    await act(async () => {
      await live.update!({ severity: 3 });
    });
    act(() => useChangesStore.getState().applyEvent(echo([FINDING_ID])));
    await settle();
    act(() => useChangesStore.getState().applyEvent(echo([FINDING_ID_2])));
    await settle();
    expect(reads(requests)).toEqual({ detail: 2, list: 3, summary: 3, activity: 3, overview: 3 });
  });

  it("a failed write does not swallow the next real change", async () => {
    const requests = await mount({ refuse: true });
    await act(async () => {
      await live.update!({ severity: 3 });
    });
    await settle();
    expect(useChangesStore.getState().findingsRevision).toBe(0);
    act(() => useChangesStore.getState().applyEvent(echo([FINDING_ID])));
    await settle();
    expect(useChangesStore.getState().findingsRevision).toBe(1);
    expect(reads(requests).detail).toBe(2);
  });
});

describe("the own-edit skip fires once (rulings R8, ruling 15)", () => {
  beforeEach(() => {
    useChangesStore.setState({ findingsRevision: 0, findingEchoes: EMPTY_LEDGER, openProjectId: null });
  });

  it("edit A, switch to B, back to A: A's detail is re-read and shown", async () => {
    const detailB = { ...exampleFindingDetail, id: FINDING_ID_2 };
    const { api, requests } = fakeClient([
      { method: "GET", path: DETAIL, body: detail },
      { method: "GET", path: new RegExp(`/findings/${FINDING_ID_2}$`), body: detailB },
      { method: "PATCH", path: DETAIL, body: (r) => ({ ...detail, ...(r.body as object) }) },
    ]);
    const seen: { id: string | null; update: ((p: FindingPatch) => Promise<void>) | null } = {
      id: null,
      update: null,
    };
    function Probe({ id }: { id: string }) {
      const { finding, update } = useFinding(PROJECT_ID, id);
      useEffect(() => {
        seen.id = finding?.id ?? null;
        seen.update = update;
      });
      return null;
    }
    const view = render(
      <TestApiProvider api={api}>
        <Probe id={FINDING_ID} />
      </TestApiProvider>,
    );
    await waitFor(() => expect(seen.id).toBe(FINDING_ID));
    await act(async () => {
      await seen.update!({ severity: 3 });
    });
    view.rerender(
      <TestApiProvider api={api}>
        <Probe id={FINDING_ID_2} />
      </TestApiProvider>,
    );
    await waitFor(() => expect(seen.id).toBe(FINDING_ID_2));
    view.rerender(
      <TestApiProvider api={api}>
        <Probe id={FINDING_ID} />
      </TestApiProvider>,
    );
    await waitFor(() => expect(seen.id).toBe(FINDING_ID));
    expect(reads(requests).detail).toBe(2);
  });
});
