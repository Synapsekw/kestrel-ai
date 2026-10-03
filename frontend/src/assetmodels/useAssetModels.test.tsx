import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TestApiProvider } from "@/test/render";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { MODEL } from "@/test/assetModelFixtures";
import { useAssetModelList } from "./useAssetModels";

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
});
