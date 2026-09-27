import { act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeStores, renderInWorkspace } from "./test/harness";
import { useSiteMapProbe } from "./diagnostics";

function Probe() {
  useSiteMapProbe();
  return null;
}

const api = {
  centreOn: () => {},
  fit: () => {},
  zoomBy: () => {},
  resetNorth: () => {},
  pixelOf: ([e, n]: [number, number]) => [e - 500000, 4983000 - n] as [number, number],
  coordOf: ([x, y]: [number, number]) => [x + 500000, 4983000 - y] as [number, number],
};

afterEach(() => localStorage.removeItem("kestrel.diagnostics"));

describe("the site map diagnostics probe (M-X e2e)", () => {
  it("is not installed unless diagnostics are on", () => {
    const stores = makeStores();
    act(() => stores.workspace.getState().setViewApi(api));
    renderInWorkspace(<Probe />, { stores });
    expect(window.__kestrelSiteMap).toBeUndefined();
  });

  it("converts both ways while mounted and is removed on unmount", () => {
    localStorage.setItem("kestrel.diagnostics", "1");
    const stores = makeStores();
    act(() => {
      stores.workspace.getState().setViewApi(api);
      stores.workspace.getState().setViewInfo({ center: [0, 0], resolution: 0.25, rotation: 0 });
    });
    const { unmount } = renderInWorkspace(<Probe />, { stores });
    expect(window.__kestrelSiteMap?.pixelOf(500010, 4982990)).toEqual([10, 10]);
    expect(window.__kestrelSiteMap?.coordOf(10, 10)).toEqual([500010, 4982990]);
    expect(window.__kestrelSiteMap?.resolution()).toBe(0.25);
    unmount();
    expect(window.__kestrelSiteMap).toBeUndefined();
  });
});
