import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TestApiProvider } from "@/test/render";
import { errorBody, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { MODEL } from "@/test/assetModelFixtures";
import { MODEL_REVIEWED } from "@/test/assetFindingFixtures";
import { useJobsStore } from "@/store/jobs";
import { useAssetModelList } from "./useAssetModels";

afterEach(() => useJobsStore.setState({ jobs: {} }));

describe("useAssetModelList", () => {
  it("a failed reload keeps the shown list and sets the error (M1 deferred M7)", async () => {
    let calls = 0;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/asset-models$/,
        status: () => (++calls === 1 ? 200 : 500),
        body: () => (calls === 1 ? { items: [MODEL] } : errorBody("internal", "The server did not answer.")),
      },
    ] as never);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const { result } = renderHook(() => useAssetModelList(PROJECT_ID), { wrapper });
    await waitFor(() => expect(result.current.models).toHaveLength(1));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.models).toHaveLength(1);
  });

  it.each(["review_kit_import", "asset_glb_import"])("reloads when a %s job finishes", async (type) => {
    const client = fakeClient([
      { method: "GET", path: /\/asset-models$/, body: { items: [MODEL_REVIEWED] } },
    ] as never);
    renderHook(() => useAssetModelList(PROJECT_ID), {
      wrapper: ({ children }) => <TestApiProvider api={client.api}>{children}</TestApiProvider>,
    });
    const reads = () => client.requests.filter((r) => r.method === "GET").length;
    await waitFor(() => expect(reads()).toBe(1));
    act(() => useJobsStore.getState().upsert({ ...runningJob, type } as never));
    act(() => useJobsStore.getState().upsert({ ...runningJob, type, state: "succeeded" } as never));
    await waitFor(() => expect(reads()).toBe(2));
  });
});
