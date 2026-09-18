import type { ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { errorBody, exampleModel, exampleTrainedModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useModels } from "./useModels";

function wrapperFor(api: ReturnType<typeof fakeClient>["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("useModels", () => {
  it("loads the registry and supports replace and remove", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
    ]);
    const { result } = renderHook(() => useModels(PROJECT_ID), { wrapper: wrapperFor(api) });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.models.map((m) => m.id)).toEqual([exampleModel.id]);
    act(() => result.current.replace(exampleTrainedModel));
    expect(result.current.models.map((m) => m.id)).toEqual([exampleTrainedModel.id, exampleModel.id]);
    act(() => result.current.replace({ ...exampleModel, name: "renamed" }));
    expect(result.current.models[1].name).toBe("renamed");
    act(() => result.current.remove(exampleModel.id));
    expect(result.current.models.map((m) => m.id)).toEqual([exampleTrainedModel.id]);
  });

  it("marks the registry unavailable on 501 and reports other errors", async () => {
    const stub = fakeClient([
      { method: "GET", path: /\/models$/, status: 501, body: errorBody("not_implemented", "S3 later") },
    ]);
    const { result } = renderHook(() => useModels(PROJECT_ID), { wrapper: wrapperFor(stub.api) });
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.error).toBeNull();
    const broken = fakeClient([
      { method: "GET", path: /\/models$/, status: 500, body: errorBody("internal_error", "disk full") },
    ]);
    const bad = renderHook(() => useModels(PROJECT_ID), { wrapper: wrapperFor(broken.api) });
    await waitFor(() => expect(bad.result.current.error).toBe("disk full"));
    expect(bad.result.current.unavailable).toBe(false);
  });
});
