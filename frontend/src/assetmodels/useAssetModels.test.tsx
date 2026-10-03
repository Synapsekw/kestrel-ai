import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TestApiProvider } from "@/test/render";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { MODEL_REVIEWED } from "@/test/assetFindingFixtures";
import { useJobsStore } from "@/store/jobs";
import { useAssetModelList } from "./useAssetModels";

afterEach(() => useJobsStore.setState({ jobs: {} }));

describe("useAssetModelList", () => {
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
