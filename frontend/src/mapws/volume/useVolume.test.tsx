import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { collectDiagnostics } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { PROJECT_ID, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { MEASUREMENT_ID, exampleMeasurement, exampleSurface } from "@/test/volumeFixtures";
import { useToastStore } from "@/ui";
import { useVolume } from "./useVolume";

const wrap = (api: ReturnType<typeof fakeClient>["api"]) =>
  function W({ children }: { children: ReactNode }) {
    return <TestApiProvider api={api}>{children}</TestApiProvider>;
  };

describe("useVolume", () => {
  beforeEach(() => useToastStore.getState().clear());

  it("a failed load is logged and shown inline, never a toast (T16-1)", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/volumes\/[^/]+$/,
        status: 500,
        body: { error: { code: "internal", message: "volume read broke", details: {} } },
      },
      { method: "GET", path: /\/surfaces$/, body: { items: [exampleSurface] } },
    ]);
    const { result } = renderHook(() => useVolume(PROJECT_ID, MEASUREMENT_ID), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.error).toBe("volume read broke"));
    expect(collectDiagnostics()).toContain("load the measurement failed: volume read broke");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("re-reads the measurement when findings change (a masked volume can go stale)", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/volumes\/[^/]+$/, body: exampleMeasurement },
      { method: "GET", path: /\/surfaces$/, body: { items: [exampleSurface] } },
    ]);
    const reads = () => requests.filter((r) => /\/volumes\/[^/?]+(\?|$)/.test(r.url)).length;
    const { result } = renderHook(() => useVolume(PROJECT_ID, MEASUREMENT_ID), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.m?.id).toBe(MEASUREMENT_ID));
    expect(reads()).toBe(1);
    act(() => useChangesStore.getState().bumpFindings());
    await waitFor(() => expect(reads()).toBe(2));
  });
});
