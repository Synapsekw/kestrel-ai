import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiContext } from "@/api/client";
import { errorBody, fakeClient, IMAGE_ID, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { useChangesStore } from "@/store/changes";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { makeDetail, makeMeasurement, makeShape } from "./testing";
import { useImageData } from "./useImageData";

const st = () => useImagesWorkspace.getState();

function wrap(routes: FakeRoute[]) {
  const { api, requests } = fakeClient(routes);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ApiContext.Provider
      value={{
        client: api,
        info: { baseUrl: "http://fake", token: "t", mode: "mock", logPath: null },
        health: {} as never,
      }}
    >
      {children}
    </ApiContext.Provider>
  );
  return { wrapper, requests };
}

const base: FakeRoute[] = [
  { method: "GET", path: new RegExp(`/images/${IMAGE_ID}$`), body: makeDetail() },
  { method: "GET", path: /\/boxes$/, body: { items: [makeShape({ id: "a" })] } },
];

beforeEach(() => st().reset());

describe("useImageData", () => {
  it("loads the image, its shapes and its measurements into the store", async () => {
    const { wrapper } = wrap([
      ...base,
      { method: "GET", path: /\/measurements$/, body: { items: [makeMeasurement({ id: "m" })] } },
    ]);
    const { result } = renderHook(() => useImageData(PROJECT_ID, IMAGE_ID), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(st().imageId).toBe(IMAGE_ID);
    expect(Object.keys(st().boxes)).toEqual(["a"]);
    expect(Object.keys(st().measurements)).toEqual(["m"]);
    expect(st().projectId).toBe(PROJECT_ID);
  });

  it("treats a not-yet-built measurements route (501) as none", async () => {
    const { wrapper } = wrap([
      ...base,
      { method: "GET", path: /\/measurements$/, status: 501, body: errorBody("not_implemented", "later") },
    ]);
    const { result } = renderHook(() => useImageData(PROJECT_ID, IMAGE_ID), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(st().measurements).toEqual({});
  });

  it("reports a missing frame", async () => {
    const { wrapper } = wrap([
      {
        method: "GET",
        path: new RegExp(`/images/${IMAGE_ID}$`),
        status: 404,
        body: errorBody("not_found", "Image not found"),
      },
      { method: "GET", path: /\/boxes$/, body: { items: [] } },
      { method: "GET", path: /\/measurements$/, body: { items: [] } },
    ]);
    const { result } = renderHook(() => useImageData(PROJECT_ID, IMAGE_ID), { wrapper });
    await waitFor(() => expect(result.current.error).toBe("Image not found"));
  });

  it("reloads the shapes when a job changes them", async () => {
    const { wrapper, requests } = wrap([
      ...base,
      { method: "GET", path: /\/measurements$/, body: { items: [] } },
    ]);
    const { result } = renderHook(() => useImageData(PROJECT_ID, IMAGE_ID), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = requests.filter((r) => r.url.endsWith("/boxes")).length;
    act(() => useChangesStore.setState((s) => ({ boxesRevision: { ...s.boxesRevision, [IMAGE_ID]: 1 } })));
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/boxes")).length).toBe(before + 1));
  });
});
