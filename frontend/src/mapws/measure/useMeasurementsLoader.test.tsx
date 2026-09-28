import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MEASUREMENTS_PAGE } from "@/api/mapMeasurements";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { bumpMapMeasurements } from "@/mapws/annotations/bindings";
import { LOCAL, UTM38, measurement } from "@/mapws/test/w3Fixtures";
import type { SiteFrame } from "@/mapws/annotations/bindings";
import { useMeasurementsStore } from "./store";
import { useMeasurementsLoader } from "./useMeasurementsLoader";

function setup(pages: "one" | "endless" = "one") {
  let n = 0;
  const { api, requests } = fakeClient([
    {
      method: "GET",
      path: /\/map-measurements$/,
      body: () =>
        pages === "one"
          ? { items: [measurement("distance")], next_cursor: null }
          : {
              items: Array.from({ length: MEASUREMENTS_PAGE }, () =>
                measurement("distance", { id: `m${n++}` }),
              ),
              next_cursor: `c${n}`,
            },
    },
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>{children}</TestApiProvider>
  );
  return { requests, wrapper };
}

const reads = (requests: { url: string }[]) =>
  requests.filter((r) => r.url.includes("/map-measurements")).length;

describe("useMeasurementsLoader (bounded read, spec §13)", () => {
  beforeEach(() => {
    useMeasurementsStore.getState().set([], false);
  });

  it("reads 500 a page in the site frame into the store, and again on each revision", async () => {
    const { requests, wrapper } = setup();
    renderHook(() => useMeasurementsLoader(PROJECT_ID, UTM38, true), { wrapper });
    await waitFor(() => expect(useMeasurementsStore.getState().items).toHaveLength(1));
    expect(reads(requests)).toBe(1);
    expect(requests[0].url).toContain("frame=site");
    expect(requests[0].url).toContain(`limit=${MEASUREMENTS_PAGE}`);
    act(() => bumpMapMeasurements());
    await waitFor(() => expect(reads(requests)).toBe(2));
  });

  it("stops at 4 pages and flags the row truncated", async () => {
    const { requests, wrapper } = setup("endless");
    renderHook(() => useMeasurementsLoader(PROJECT_ID, UTM38, true), { wrapper });
    await waitFor(() => expect(useMeasurementsStore.getState().truncated).toBe(true));
    expect(reads(requests)).toBe(4);
    expect(useMeasurementsStore.getState().items).toHaveLength(2000);
  });

  it("re-reads when the site frame changes", async () => {
    const { requests, wrapper } = setup();
    const { rerender } = renderHook(
      ({ frame }: { frame: SiteFrame }) => useMeasurementsLoader(PROJECT_ID, frame, true),
      {
        wrapper,
        initialProps: { frame: UTM38 },
      },
    );
    await waitFor(() => expect(reads(requests)).toBe(1));
    rerender({ frame: { ...UTM38 } });
    rerender({ frame: LOCAL });
    await waitFor(() => expect(reads(requests)).toBe(2));
  });

  it("the left map of Side-by-side reads nothing (it shares the store)", async () => {
    const { requests, wrapper } = setup();
    renderHook(() => useMeasurementsLoader(PROJECT_ID, UTM38, false), { wrapper });
    act(() => bumpMapMeasurements());
    await new Promise((r) => setTimeout(r, 20));
    expect(reads(requests)).toBe(0);
  });
});
