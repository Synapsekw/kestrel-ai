import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { CLOUD_ID } from "@/test/cloudFixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import { MAX_PER_CLOUD, useCloudMeasurements } from "./useCloudMeasurements";

const m = (id: string, status: CloudMeasurement["status"] = "ready") =>
  ({ id, point_cloud_id: CLOUD_ID, kind: "distance", name: id, status }) as unknown as CloudMeasurement;

function setup(answers: CloudMeasurement[][]) {
  let call = 0;
  const { api, requests } = fakeClient([
    {
      method: "GET",
      path: /\/measurements$/,
      body: () => ({ items: answers[Math.min(call++, answers.length - 1)] }),
    },
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>{children}</TestApiProvider>
  );
  return { api, requests, wrapper };
}

describe("useCloudMeasurements", () => {
  beforeEach(() => useChangesStore.setState({ pointcloudsRevision: 0 }));

  it("loads the cloud's list and re-reads it on pointclouds.changed", async () => {
    const { wrapper, requests } = setup([[m("a", "computing")], [m("a", "ready")]]);
    const { result } = renderHook(() => useCloudMeasurements(PROJECT_ID, CLOUD_ID), { wrapper });
    await waitFor(() => expect(result.current.items[0]?.status).toBe("computing"));
    act(() => useChangesStore.setState((s) => ({ pointcloudsRevision: s.pointcloudsRevision + 1 })));
    await waitFor(() => expect(result.current.items[0]?.status).toBe("ready"));
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(2);
  });

  it("adds and replaces rows locally, and forgets the selection on another cloud", async () => {
    const { wrapper } = setup([[m("a")]]);
    const { result, rerender } = renderHook(({ id }) => useCloudMeasurements(PROJECT_ID, id), {
      wrapper,
      initialProps: { id: CLOUD_ID as string | null },
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.upsert(m("b")));
    act(() => result.current.upsert({ ...m("a"), name: "renamed" }));
    expect(result.current.items.map((x) => x.name)).toEqual(["renamed", "b"]);
    act(() => result.current.select("b"));
    expect(result.current.selected?.id).toBe("b");
    rerender({ id: "other-cloud" });
    expect(result.current.selectedId).toBeNull();
    expect(result.current.items).toEqual([]);
  });

  it("says when the cloud is full", async () => {
    const { wrapper } = setup([Array.from({ length: MAX_PER_CLOUD }, (_, i) => m(`m${i}`))]);
    const { result } = renderHook(() => useCloudMeasurements(PROJECT_ID, CLOUD_ID), { wrapper });
    await waitFor(() => expect(result.current.full).toBe(true));
  });
});
